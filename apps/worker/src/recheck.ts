import { type DealView, dealSchema, dealState, productSchema } from '@deals/core';
import {
  desc,
  eq,
  fileProposal,
  listDeals,
  pageSnapshots,
  priceObservations,
  sql,
} from '@deals/db';
import { z } from 'zod';
import { zodParse } from './llm.ts';
import { RECHECK_SYSTEM, recheckUser } from './prompts.ts';
import { type Ctx, type Job, saveSnapshot, today } from './runtime.ts';
import { translatePayload } from './translate.ts';
import { bump, errorMessage, mapPool, sha256 } from './util.ts';
import {
  codeAppears,
  mergeVolatile,
  numberAppears,
  VOLATILE_FIELDS,
  verifyEvidence,
} from './verify.ts';

const LLM_TEXT_CHARS = 40_000;
/** Bot walls answer these; they say nothing about the page being gone. */
const SOFT_STATUSES = new Set([403, 429]);

/** The model writes Chinese only; an unchanged zh keeps its published English because `mergeVolatile` only replaces a field whose zh differs. */
const both = z
  .string()
  .trim()
  .min(1)
  .transform((zh) => ({ zh, en: '' }));
const isoDay = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const zone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA time zone');
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

const recheckSchema = z.object({
  offerStillValid: z.boolean().catch(true),
  deal: z
    .object({
      priceAmount: optional(z.number()),
      originalAmount: optional(z.number()),
      currency: optional(z.string()),
      discountPercent: optional(z.number()),
      discountAmount: optional(z.number()),
      code: optional(z.string()),
      noCode: optional(z.boolean()),
      startsOn: optional(isoDay),
      endsOn: optional(isoDay),
      startsAt: optional(instant),
      endsAt: optional(instant),
      dateZone: optional(zone),
      terms: optional(both),
      renewal: optional(both),
      eligibility: optional(both),
    })
    .nullish()
    .transform((v) => v ?? {}),
  evidence: z
    .array(z.object({ field: z.string(), quote: z.string() }))
    .nullish()
    .transform((v) => v ?? []),
  confidence: z.number().min(0).max(1).catch(0.5),
});

const OFFER_ENDED =
  /\b(ended|expired|over|closed|no longer|unavailable|sold out|discontinued|withdrawn|finished)\b|已结束|已过期|已截止|已下架|不再/i;
/** Amount fields are only updated when a published value exists to compare against. */
const NO_NEW_AMOUNTS = new Set([
  'priceAmount',
  'originalAmount',
  'currency',
  'discountPercent',
  'discountAmount',
]);

const isDown = (status: number | null, error: string | null) =>
  error !== null &&
  (error === 'timeout' ||
    error.startsWith('network') ||
    (status !== null && status >= 400 && !SOFT_STATUSES.has(status)));

/** Numbers and codes must be written on the page; anything else is only a claim by the model. */
function appearsOnPage(field: string, value: unknown, text: string): boolean {
  if (typeof value === 'number') return numberAppears(value, text);
  if (field === 'code' && typeof value === 'string') return codeAppears(value, text);
  return true;
}

async function checkDeal(ctx: Ctx, view: DealView): Promise<void> {
  const { db, stats } = ctx;
  const day = today();
  const url = view.merchantUrl;
  const before = dealSchema.parse(view);

  const snapshots = () => db.select().from(pageSnapshots).orderBy(desc(pageSnapshots.id)).limit(1);
  const [[prevAny], [prevHashed], [lastObservation]] = await Promise.all([
    snapshots().where(eq(pageSnapshots.url, url)),
    snapshots().where(
      sql`${pageSnapshots.url} = ${url} and ${pageSnapshots.contentHash} is not null`,
    ),
    db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.dealId, view.id))
      .orderBy(desc(priceObservations.id))
      .limit(1),
  ]);

  const page = await ctx.fetcher.page(url);
  const changed = page.hash !== null && page.hash !== prevHashed?.contentHash;
  const snapshotId = await saveSnapshot(ctx, url, page, changed);
  bump(stats, 'checked');

  const observe = async (priceAmount: number | null, codePresent: boolean | null) => {
    bump(stats, 'observations');
    if (ctx.dryRun) return;
    await db.insert(priceObservations).values({
      dealId: view.id,
      priceAmount,
      currency: before.currency,
      codePresent,
      snapshotId,
    });
  };

  const flag = async (
    reason: string,
    detail: string,
    evidence: Array<{ field: string; quote: string; url: string }> = [],
  ) => {
    bump(stats, 'flags');
    ctx.log(`${view.product.name}: flag ${reason} (${detail})`);
    if (ctx.dryRun) return;
    await fileProposal(db, {
      kind: 'flag',
      dealId: view.id,
      payload: null,
      changes: [],
      evidence,
      reason: `${reason}：${detail}`,
      confidence: null,
      dedupeKey: `flag:${view.id}:${reason}:${day}`,
      sourceRef: url,
    });
  };

  if (page.error === 'empty-text') {
    bump(stats, 'emptyText');
    return observe(before.priceAmount, null);
  }
  if (page.error) {
    // Failing twice in a row (this fetch and the previous snapshot) is a signal; once is noise.
    if (
      isDown(page.status, page.error) &&
      isDown(prevAny?.httpStatus ?? null, prevAny?.error ?? null)
    ) {
      await flag('page-unavailable', `${page.error}，上次检查也失败（${prevAny?.error}）`);
    }
    return observe(null, null);
  }

  const codePresent = before.code ? codeAppears(before.code, page.text) : null;
  if (before.code && codePresent === false && lastObservation?.codePresent === true) {
    await flag('code-missing', `页面不再出现优惠码 ${before.code}`);
  }
  if (!changed) {
    bump(stats, 'unchanged');
    return observe(before.priceAmount, codePresent);
  }

  bump(stats, 'changed');
  // The model only sees (and writes) the Chinese of the editorial fields.
  const current = Object.fromEntries(
    VOLATILE_FIELDS.map((f) => {
      const value = before[f];
      return [f, value !== null && typeof value === 'object' ? value.zh : value];
    }),
  );
  const result = await ctx.extractLlm.json({
    system: RECHECK_SYSTEM,
    user: recheckUser(day, current, {
      url: page.url,
      title: page.title,
      text: page.text.slice(0, LLM_TEXT_CHARS),
    }),
    parse: zodParse(recheckSchema),
  });
  const { kept, dropped } = verifyEvidence(result.evidence, [{ url: page.url, text: page.text }]);

  if (!result.offerStillValid) {
    // The quote itself has to say so; the model has cited unrelated pricing lines before.
    const proof = kept.filter((e) => OFFER_ENDED.test(e.quote));
    if (proof.length) await flag('offer-ended', proof[0]?.quote ?? '', proof);
    else ctx.log(`${view.product.name}: offer-ended claim without a supporting quote ignored`);
    return observe(before.priceAmount, codePresent);
  }

  // Changed values the page does not literally contain are dropped, then the rest is re-merged.
  const accepted = Object.fromEntries(
    mergeVolatile(before, result.deal)
      .changes.filter((change) => {
        if (change.before === null && NO_NEW_AMOUNTS.has(change.field)) {
          // Change detection, not first extraction: the model has misread "from $X" prices.
          ctx.log(
            `${view.product.name}: ignored new ${change.field} ${JSON.stringify(change.after)}`,
          );
          return false;
        }
        if (appearsOnPage(change.field, change.after, page.text)) return true;
        ctx.log(
          `${view.product.name}: ignored ${change.field} -> ${JSON.stringify(change.after)} (not on the page)`,
        );
        return false;
      })
      .map((change) => [change.field, change.after]),
  );
  // Pages localize currency by visitor region; a currency switch with the same amounts is not a deal change.
  if (!['priceAmount', 'originalAmount', 'discountAmount'].some((field) => field in accepted)) {
    delete accepted.currency;
  }
  const proposed = mergeVolatile(before, accepted);
  const observedPrice = proposed.deal.priceAmount ?? before.priceAmount;
  if (!proposed.changes.length) return observe(observedPrice, codePresent);
  if (!kept.length) {
    ctx.log(`${view.product.name}: changes without verbatim evidence ignored`);
    bump(stats, 'unverifiedChanges');
    return observe(before.priceAmount, codePresent);
  }

  const valid = dealSchema.safeParse({ ...proposed.deal, checkedOn: day });
  if (!valid.success) {
    ctx.log(
      `${view.product.name}: proposed update invalid: ${z.prettifyError(valid.error).slice(0, 200)}`,
    );
    bump(stats, 'unverifiedChanges');
    return observe(before.priceAmount, codePresent);
  }

  const confidence = Math.round(Math.max(0.05, result.confidence - 0.1 * dropped) * 100) / 100;
  const fields = proposed.changes.map((c) => c.field).join('、');
  ctx.log(`${view.product.name}: update ${fields} (confidence ${confidence})`);
  if (ctx.dryRun) {
    ctx.log(`  ${JSON.stringify(proposed.changes)}`);
  } else {
    // Rewritten editorial fields arrive as zh only; translate them now so approval publishes both.
    const finished = await translatePayload(ctx, productSchema.parse(view.product), valid.data);
    const changes = proposed.changes.map((change) =>
      change.field === 'terms' || change.field === 'renewal' || change.field === 'eligibility'
        ? { ...change, after: finished.deal[change.field] }
        : change,
    );
    const id = await fileProposal(db, {
      kind: 'update',
      dealId: view.id,
      payload: { product: finished.product, event: view.event.slug, deal: finished.deal },
      changes,
      evidence: kept,
      reason: `商家页内容变化，重新抽取后字段不同：${fields}`,
      confidence,
      dedupeKey: `update:${view.id}:${sha256(JSON.stringify(proposed.changes)).slice(0, 12)}`,
      sourceRef: page.url,
    });
    if (id) bump(stats, 'proposals');
    else bump(stats, 'duplicates');
  }
  return observe(observedPrice, codePresent);
}

export const recheck: Job = async (ctx) => {
  const now = new Date();
  const published = await listDeals(ctx.db, { statuses: ['published'] });
  const active = published.filter((d) => dealState(d, now) !== 'ended');
  // Longest-unchecked first so a capped run rotates through the catalog.
  const last = await ctx.db
    .select({
      dealId: priceObservations.dealId,
      at: sql`max(${priceObservations.observedAt})`.mapWith(priceObservations.observedAt),
    })
    .from(priceObservations)
    .groupBy(priceObservations.dealId);
  const lastAt = new Map(last.map((r) => [r.dealId, r.at.getTime()]));
  active.sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0) || a.id - b.id);
  const batch = ctx.limit ? active.slice(0, ctx.limit) : active;
  ctx.log(`${batch.length} of ${active.length} active deals to check`);
  await mapPool(
    batch,
    3,
    ctx.signal,
    (deal) => checkDeal(ctx, deal),
    (deal, error) => {
      bump(ctx.stats, 'errors');
      ctx.log(`${deal.product.name}: ${errorMessage(error)}`);
    },
  );
};
