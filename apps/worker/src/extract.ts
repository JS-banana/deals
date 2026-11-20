import {
  BILLING,
  CATEGORY_SLUGS,
  type Deal,
  dealSchema,
  type Product,
  productSchema,
} from '@deals/core';
import { type Evidence, fileProposal } from '@deals/db';
import { z } from 'zod';
import { zodParse } from './llm.ts';
import { EXTRACT_SYSTEM, extractUser } from './prompts.ts';
import { type Ctx, type Job, saveSnapshot, today } from './runtime.ts';
import { translatePayload } from './translate.ts';
import {
  type Catalog,
  cleanMerchantUrl,
  discover,
  findKnown,
  hostOf,
  isSharedHost,
  permalink,
  slugify,
  type UpstreamEntry,
} from './upstream.ts';
import { bump, errorMessage, mapPool } from './util.ts';
import { checkDates, pickEvent, stripUnverified, verifyEvidence } from './verify.ts';

const LLM_TEXT_CHARS = 40_000;
const MIN_CONFIDENCE = 0.3;

/** The model writes Chinese only; English is left empty for the translate job. */
const both = z
  .string()
  .trim()
  .min(1)
  .transform((zh) => ({ zh, en: '' }));
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

/** What the model returns; the pipeline fills in slug, website, URLs, `verified` and `checkedOn`. */
const extractionSchema = z
  .object({
    skip: z.object({ reason: z.string() }).nullish(),
    product: z.object({ category: z.enum(CATEGORY_SLUGS), summary: both }).nullish(),
    deal: z
      .object({
        plan: both,
        priceAmount: optional(z.number()),
        originalAmount: optional(z.number()),
        currency: optional(z.string()),
        billing: z.enum(BILLING),
        discountPercent: optional(z.number()),
        discountAmount: optional(z.number()),
        code: optional(z.string()),
        noCode: z
          .boolean()
          .nullish()
          .transform((v) => v ?? false),
        startsOn: optional(z.string()),
        endsOn: optional(z.string()),
        startsAt: optional(z.string()),
        endsAt: optional(z.string()),
        dateZone: optional(z.string()),
        observedLiveOn: optional(z.string()),
        oneTime: z
          .boolean()
          .nullish()
          .transform((v) => v ?? false),
        existingUsers: z
          .boolean()
          .nullish()
          .transform((v) => v ?? false),
        terms: both,
        renewal: optional(both),
        eligibility: optional(both),
        cardNote: optional(both),
      })
      .nullish(),
    evidence: z
      .array(z.object({ field: z.string(), quote: z.string() }))
      .nullish()
      .transform((v) => v ?? []),
    confidence: z.number().min(0).max(1).catch(0.5),
  })
  .refine(
    (v) => v.skip || (v.product && v.deal),
    'product and deal are required unless skip is set',
  );

export type Outcome =
  | { status: 'proposal'; filed: boolean }
  | { status: 'skip'; reason: string; detail?: string }
  | { status: 'retry'; reason: string };

const skip = (reason: string, detail?: string): Outcome =>
  detail === undefined ? { status: 'skip', reason } : { status: 'skip', reason, detail };

/** Merchant page + upstream line -> verified `create` proposal (never a direct write). */
export async function extractCandidate(
  ctx: Ctx,
  input: { entry: UpstreamEntry; sha: string; catalog: Catalog },
): Promise<Outcome> {
  const { entry, sha, catalog } = input;
  const day = today();
  const sourceRef = permalink(sha, entry.line);

  let merchantUrl: string;
  try {
    merchantUrl = cleanMerchantUrl(entry.url);
  } catch {
    return skip('bad-url');
  }

  const page = await ctx.fetcher.page(merchantUrl);
  await saveSnapshot(ctx, merchantUrl, page);
  if (page.error === 'empty-text') {
    bump(ctx.stats, 'emptyText');
    return skip('empty-text');
  }
  if (page.error) {
    const transient = page.status === null || page.status >= 500;
    return transient ? { status: 'retry', reason: page.error } : skip(page.error);
  }

  const known = findKnown(catalog, entry);
  const slug = known?.slug ?? slugify(entry.name);
  const host = hostOf(merchantUrl);
  const websiteOf = () => (isSharedHost(host) ? null : new URL(merchantUrl).origin);

  const extraction = await ctx.extractLlm.json({
    system: EXTRACT_SYSTEM,
    user: extractUser(day, entry, {
      url: page.url,
      title: page.title,
      text: page.text.slice(0, LLM_TEXT_CHARS),
    }),
    parse: (raw) => {
      const value = zodParse(extractionSchema)(raw);
      if (value.skip || !value.product || !value.deal) return { ...value, built: null };
      // Build the final records here so schema problems go back to the model for repair.
      const product = productSchema.safeParse({
        slug,
        name: entry.name,
        category: value.product.category,
        website: websiteOf(),
        summary: value.product.summary,
        logoPath: null,
      });
      const deal = dealSchema.safeParse({
        ...value.deal,
        observedLiveOn: value.deal.observedLiveOn ? day : null,
        merchantUrl,
        sourceUrl: sourceRef,
        verified: false,
        checkedOn: day,
      });
      const problems = [product, deal].flatMap((r) =>
        r.success ? [] : [z.prettifyError(r.error)],
      );
      if (problems.length || !product.success || !deal.success)
        throw new Error(problems.join('\n'));
      return { ...value, built: { product: product.data, deal: deal.data } };
    },
  });

  if (extraction.skip) return skip('llm-skip', extraction.skip.reason);
  if (!extraction.built) throw new Error('extraction produced no deal');

  // Deterministic checks: nothing unverifiable survives into the proposal.
  const sources = [
    { url: page.url, text: page.text },
    { url: sourceRef, text: entry.raw },
  ];
  const sourceText = sources.map((s) => s.text).join('\n');
  const notes: string[] = [];
  const stripped = stripUnverified(extraction.built.deal, sourceText);
  const dates = checkDates(stripped.deal, new Date(), day);
  notes.push(...stripped.notes, ...dates.notes);
  if (dates.ended) return skip('ended');
  const checked = dealSchema.safeParse(dates.deal);
  if (!checked.success) return skip('unverifiable', z.prettifyError(checked.error).slice(0, 200));
  const deal: Deal = checked.data;

  const { kept, dropped } = verifyEvidence(extraction.evidence, sources);
  if (!kept.length) return skip('no-verified-evidence');
  let confidence = extraction.confidence - 0.1 * dropped - 0.15 * notes.length;
  if (!kept.some((e) => e.url === page.url)) confidence = Math.min(confidence, 0.6);
  confidence = Math.round(Math.max(0.05, Math.min(1, confidence)) * 100) / 100;
  if (confidence < MIN_CONFIDENCE) return skip('low-confidence', String(confidence));

  const product: Product = known ? productSchema.parse({ ...known }) : extraction.built.product;
  const event = pickEvent(catalog.events, deal, day);
  const evidence: Evidence[] = kept;
  const reason = [
    `上游榜单新条目（${entry.section}）`,
    `商家页 ${page.url}`,
    `证据 ${kept.length}/${kept.length + dropped} 条通过原文核对`,
    ...notes,
  ].join('；');

  if (ctx.dryRun) {
    ctx.log(
      `${entry.name}: would file create/${event} ${JSON.stringify({ deal, evidence, confidence })}`,
    );
    return { status: 'proposal', filed: true };
  }
  // English is produced here, before filing, so approving publishes both languages at once.
  const finished = await translatePayload(ctx, product, deal);
  const id = await fileProposal(ctx.db, {
    kind: 'create',
    payload: { product: finished.product, event, deal: finished.deal },
    changes: [],
    evidence,
    reason,
    confidence,
    dedupeKey: `create:${event}:${slug}`,
    sourceRef,
  });
  ctx.log(
    `${entry.name}: ${id ? `proposal #${id}` : 'duplicate'} (${event}, confidence ${confidence})`,
  );
  return { status: 'proposal', filed: id !== null };
}

/** `sync-upstream`: discover new upstream entries, then turn each into a proposal. */
export const syncUpstream: Job = async (ctx) => {
  const found = await discover(ctx);
  ctx.stats.candidates = found.candidates.length;
  ctx.stats.skippedExisting = found.existing;
  ctx.stats.backlog = found.backlog;
  await mapPool(
    found.candidates,
    3,
    ctx.signal,
    async (entry) => {
      const outcome = await extractCandidate(ctx, {
        entry,
        sha: found.sha,
        catalog: found.catalog,
      });
      if (outcome.status === 'retry') throw new Error(outcome.reason);
      found.done(entry.key);
      if (outcome.status === 'proposal')
        bump(ctx.stats, outcome.filed ? 'proposals' : 'duplicates');
      else {
        bump(ctx.stats, 'skipped');
        bump(ctx.stats, `skip:${outcome.reason}`);
        ctx.log(
          `${entry.name}: skipped (${outcome.reason}${outcome.detail ? `: ${outcome.detail}` : ''})`,
        );
      }
    },
    (entry, error) => {
      bump(ctx.stats, 'errors');
      const tries = found.failed(entry.key);
      ctx.log(`${entry.name}: failed (try ${tries}): ${errorMessage(error)}`);
    },
  );
  if (!ctx.dryRun) await found.save();
};
