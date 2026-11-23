import { readFile } from 'node:fs/promises';
import {
  and,
  eq,
  isNull,
  type RawSignal,
  rawSignals,
  sql,
  syncState,
  withAdvisoryLock,
} from '@deals/db';
import { z } from 'zod';
import { extractCandidate } from '../extract.ts';
import type { Ctx, Job } from '../runtime.ts';
import { triage } from '../triage.ts';
import {
  type Catalog,
  cleanMerchantUrl,
  entryKey,
  findKnown,
  hostOf,
  loadCatalog,
} from '../upstream.ts';
import { bump, errorMessage, sha256 } from '../util.ts';
import { hackerNews, reddit, redditConfigured, searchWeb, webSearch } from './community.ts';
import { githubReadme } from './github-readme.ts';
import { rss } from './rss.ts';
import { httpsLink, type SourceAdapter, type SourceConfig, sourceSwitch } from './types.ts';

const adapters: Partial<Record<RawSignal['sourceType'], SourceAdapter>> = {
  github: githubReadme,
  rss,
  reddit,
  hn: hackerNews,
  x: rss,
  search: webSearch,
};
const sourceConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: z.enum(['github', 'rss', 'reddit', 'hn', 'x', 'search', 'user_tip']),
  target: z.string(),
  enabled: z.boolean(),
  quota: z.number().int().positive().max(1000),
});
const legacyCursor = z.object({
  sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  processed: z.array(z.string()).optional(),
});
const OFFICIAL_RSS_HOSTS: Record<string, string> = {
  jetbrains: 'jetbrains.com',
  cloudflare: 'cloudflare.com',
  openai: 'openai.com',
};
const fast = new Set(['reddit', 'hn', 'x', 'user_tip']);
function enabled(source: SourceConfig) {
  const setting = process.env[sourceSwitch(source.id)];
  if (!(setting === undefined || setting === '' ? source.enabled : setting === 'true'))
    return false;
  if (source.type === 'reddit') return redditConfigured();
  if (source.type === 'x') return !!process.env.RSSHUB_BASE_URL;
  if (source.type === 'search')
    return (
      !!process.env.SEARCH_API_KEY &&
      (!process.env.SEARCH_API_PROVIDER || process.env.SEARCH_API_PROVIDER === 'brave')
    );
  return true;
}

async function examine(
  ctx: Ctx,
  signal: RawSignal,
  decision: Awaited<ReturnType<typeof triage>>[number],
  catalog: Catalog,
  source: SourceConfig,
) {
  if (!decision.isDeal) return 'noise';
  let url = decision.merchantUrl;
  if (!url && process.env.SEARCH_API_KEY && ['reddit', 'x', 'user_tip'].includes(source.type)) {
    // Ask the classifier to choose among returned links; the search result itself is never evidence.
    const urls = (
      await searchWeb(ctx, `${decision.productName} official ${decision.offerType} promotion`)
    ).map((h) => h.url);
    if (urls.length)
      url = (await triage(ctx, [{ ...signal, candidateUrls: urls }]))[0]?.merchantUrl ?? null;
  }
  if (!url || !httpsLink(cleanMerchantUrl(url))) return 'no-merchant-url';
  const host = hostOf(url);
  if (
    !host ||
    /(^|\.)(reddit\.com|redd\.it|news\.ycombinator\.com|x\.com|twitter\.com|t\.co)$/.test(host)
  )
    return 'no-merchant-url';
  const entry = {
    key: signal.signalKey,
    section: signal.sourceName,
    line: 0,
    name: decision.productName,
    url,
    description: signal.title,
    offer: signal.rawText,
    raw: [signal.title, signal.rawText].join('\n'),
  };
  const known = findKnown(catalog, entry, false);
  const trustedHosts = [...(known?.hosts ?? [])];
  const officialHost = OFFICIAL_RSS_HOSTS[source.id];
  if (source.type === 'rss' && typeof officialHost === 'string') trustedHosts.push(officialHost);
  const result = await extractCandidate(ctx, {
    entry,
    sourceUrl: signal.sourceUrl,
    catalog,
    trustedHosts,
  });
  if (result.status === 'retry') throw new Error(result.reason);
  return result.status === 'proposal' ? (result.filed ? 'proposals' : 'duplicates') : result.reason;
}

export async function syncSource(ctx: Ctx, source: SourceConfig, catalog: Catalog) {
  const key = `source:${source.id}`;
  const limit = ctx.limit ?? source.quota;
  const [state] = await ctx.db.select().from(syncState).where(eq(syncState.key, key));
  const cursor = typeof state?.value === 'string' ? state.value : null;
  let legacy: z.infer<typeof legacyCursor> | undefined;
  if (source.id === 'github-bfcm' && cursor === null) {
    const [row] = await ctx.db
      .select()
      .from(syncState)
      .where(eq(syncState.key, 'upstream:awesome-bfcm'));
    const parsed = legacyCursor.safeParse(row?.value);
    if (parsed.success) legacy = parsed.data;
  }
  const effectiveCursor = cursor ?? legacy?.sha ?? null;
  const legacyProcessed = new Set(legacy?.processed ?? []);
  const isLegacyProcessed = (signal: RawSignal) =>
    legacyProcessed.size > 0 &&
    legacyProcessed.has(entryKey(signal.title, signal.candidateUrls[0] ?? ''));
  const adapter = adapters[source.type];
  let fresh: RawSignal[] = [];
  if (adapter) {
    // A feed outage must not prevent processing the backlog already captured for this source.
    try {
      const batch = await adapter(ctx, source, effectiveCursor);
      fresh = batch.signals;
      if (!ctx.dryRun && (fresh.length || batch.cursor !== cursor)) {
        await ctx.db.transaction(async (tx) => {
          for (let start = 0; start < fresh.length; start += 100) {
            const values = fresh.slice(start, start + 100).map((signal) => ({
              sourceId: source.id,
              signalKey: signal.signalKey,
              fingerprint: fingerprint(signal),
              signal,
              processedAt: isLegacyProcessed(signal) ? new Date() : null,
            }));
            await tx.insert(rawSignals).values(values).onConflictDoNothing();
          }
          await tx
            .insert(syncState)
            .values({ key, value: batch.cursor })
            .onConflictDoUpdate({
              target: syncState.key,
              set: { value: batch.cursor, updatedAt: new Date() },
            });
        });
      }
    } catch (error) {
      ctx.signal.throwIfAborted();
      bump(ctx.stats, 'errors');
      ctx.log(`${source.id}: ${errorMessage(error)}`);
    }
  }
  const queue = await ctx.db
    .select()
    .from(rawSignals)
    .where(
      and(eq(rawSignals.sourceId, source.id), isNull(rawSignals.processedAt), sql`attempts < 3`),
    )
    .orderBy(rawSignals.attempts, rawSignals.id)
    .limit(limit);
  const pending: Array<{ id: number | null; signal: RawSignal }> = [...queue];
  if (ctx.dryRun && fresh.length && pending.length < limit) {
    const stored = await ctx.db
      .select({ key: rawSignals.signalKey, hash: rawSignals.fingerprint })
      .from(rawSignals)
      .where(eq(rawSignals.sourceId, source.id));
    const seen = new Set(stored.map((s) => `${s.key}:${s.hash}`));
    for (const signal of fresh) {
      if (isLegacyProcessed(signal)) continue;
      const k = `${signal.signalKey}:${fingerprint(signal)}`;
      if (!seen.has(k)) {
        pending.push({ id: null, signal });
        seen.add(k);
      }
      if (pending.length >= limit) break;
    }
  }
  ctx.stats[`queued:${source.id}`] = pending.length;
  for (let i = 0; i < pending.length; i += 18) {
    ctx.signal.throwIfAborted();
    const rows = pending.slice(i, i + 18);
    // Provider-wide failures retry the batch next run; per-signal failures have a bounded retry count.
    const decisions = await triage(
      ctx,
      rows.map((r) => r.signal),
    );
    for (const [index, row] of rows.entries()) {
      ctx.signal.throwIfAborted();
      try {
        const decision = decisions[index];
        if (!decision) throw new Error('missing triage result');
        const outcome = await examine(ctx, row.signal, decision, catalog, source);
        bump(ctx.stats, outcome);
        if (row.id !== null && !ctx.dryRun)
          await ctx.db
            .update(rawSignals)
            .set({ processedAt: new Date() })
            .where(eq(rawSignals.id, row.id));
      } catch (error) {
        ctx.signal.throwIfAborted();
        bump(ctx.stats, 'errors');
        ctx.log(`${source.id} #${row.id ?? 'preview'}: ${errorMessage(error)}`);
        if (row.id !== null && !ctx.dryRun)
          await ctx.db
            .update(rawSignals)
            .set({ attempts: sql`attempts+1` })
            .where(eq(rawSignals.id, row.id));
      }
    }
  }
}
function fingerprint(s: RawSignal) {
  return sha256(JSON.stringify([s.title, s.rawText, s.candidateUrls]));
}
export function syncSources(tier: 'fast' | 'slow' | 'upstream'): Job {
  return async (ctx) => {
    const entries = z
      .array(z.unknown())
      .parse(JSON.parse(await readFile(new URL('./registry.json', import.meta.url), 'utf8')));
    const sources: SourceConfig[] = [];
    for (const entry of entries) {
      const result = sourceConfig.safeParse(entry);
      if (!result.success || sources.some((s) => s.id === result.data.id)) {
        bump(ctx.stats, 'errors');
        ctx.log('invalid or duplicate registry entry');
        continue;
      }
      sources.push(result.data);
    }
    const catalog = await loadCatalog(ctx);
    for (const source of sources.filter((s) =>
      tier === 'upstream' ? s.id === 'github-bfcm' : fast.has(s.type) === (tier === 'fast'),
    )) {
      if (!enabled(source)) continue;
      ctx.signal.throwIfAborted();
      try {
        // Serialise cron and one-off invocations for a source without locking other sources.
        await withAdvisoryLock(ctx.db, `source:${source.id}`, () =>
          syncSource(ctx, source, catalog),
        );
      } catch (error) {
        ctx.signal.throwIfAborted();
        bump(ctx.stats, 'errors');
        ctx.log(`${source.id}: ${errorMessage(error)}`);
      }
    }
  };
}
