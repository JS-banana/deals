import {
  BILLING,
  CATEGORY_SLUGS,
  calendarDay,
  type Deal,
  type DealView,
  dealSchema,
  dealState,
  OFFER_TYPES,
  type Product,
  productSchema,
} from '@deals/core';
import { type Evidence, eq, proposals } from '@deals/db';
import { z } from 'zod';
import { zodParse } from './llm.ts';
import { extractSystem, extractUser } from './prompts.ts';
import { reviewProposal } from './review-proposal.ts';
import type { Ctx } from './runtime.ts';
import { saveSnapshot, today } from './runtime.ts';
import {
  type Catalog,
  cleanMerchantUrl,
  findKnown,
  hostOf,
  isSharedHost,
  permalink,
  slugify,
  type UpstreamEntry,
} from './upstream.ts';
import { bump, sha256 } from './util.ts';
import {
  checkDates,
  missingMerchantEvidence,
  pickEvent,
  stripUnverified,
  verifyEvidence,
} from './verify.ts';

// Offer identity is independent of the signal publisher and the current advertised price.
export function offerKeyFor(deal: Deal, merchantPlan = '') {
  const tier = merchantPlan.trim().normalize('NFKC').toLowerCase();
  // An unnamed 30-day trial or $300 grant can have more than one sibling on the same landing page.
  // Identify the entitlement itself; a different article, translated phrasing or display price
  // does not create a new offer.
  const grant =
    !tier && deal.benefitSummary && ['free_credit', 'free_trial', 'bundle'].includes(deal.offerType)
      ? (deal.benefitSummary.zh
          .normalize('NFKC')
          .toLowerCase()
          .replace(/美元|us\$|\busd\b/g, '$')
          .replace(/欧元|\beur\b/g, '€')
          .replace(/人民币|\bcny\b/g, '¥')
          .replace(/(\d[\d.,]*)\s*([$€¥£])/g, '$2$1')
          .replace(/词元|tokens?\b/g, 'token')
          .replace(/days?|天/g, 'day')
          .match(
            /(?:[$€¥£]\s*)?\d[\d.,]*(?:\s*(?:亿|万|k|m|b))?(?:\s*(?:token|day|个月|年|次|gb|tb))?/gi,
          )
          ?.map((value) => value.replace(/\s|,(?=\d{3}\b)/g, ''))
          .sort() ?? [])
      : [];
  const basis = [tier, deal.code ?? '', grant];
  return `${deal.offerType.replaceAll('_', '-')}-${deal.billing.replaceAll('_', '-')}-${sha256(JSON.stringify(basis)).slice(0, 16)}`;
}
const LLM_TEXT_CHARS = 40_000;
const MIN_CONFIDENCE = 0.3;

/** The model writes Chinese only; English is left empty for the translate job. */
const both = z
  .string()
  .trim()
  .min(1)
  .transform((zh) => ({ zh, en: '' }));
const shortSummary = z
  .string()
  .trim()
  .min(1)
  .max(60, 'product.summary must be at most 60 characters')
  .transform((zh) => ({ zh, en: '' }));
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

/** What the model returns; the pipeline fills in slug, website, URLs, `verified` and `checkedOn`. */
const extractionSchema = z
  .object({
    skip: z.object({ reason: z.string() }).nullish(),
    product: z.object({ category: z.enum(CATEGORY_SLUGS), summary: shortSummary }).nullish(),
    deal: z
      .object({
        plan: both,
        merchantPlan: z.string().trim().max(120).nullish(),
        offerType: z.enum(OFFER_TYPES).default('discount'),
        benefitSummary: optional(both),
        estimatedValue: optional(z.number()),
        howToClaim: optional(both),
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

export function isTrustedHost(host: string | null, trustedHosts: readonly string[]): boolean {
  return (
    host !== null &&
    trustedHosts.some(
      (trusted) =>
        !!trusted && !isSharedHost(trusted) && (host === trusted || host.endsWith(`.${trusted}`)),
    )
  );
}

/** Merchant page + upstream line -> audited `create` proposal. */
export async function extractCandidate(
  ctx: Ctx,
  input: {
    entry: UpstreamEntry;
    sha?: string;
    sourceUrl?: string;
    catalog: Catalog;
    trustedHosts?: string[];
    curated?: boolean;
    renewal?: DealView;
  },
): Promise<Outcome> {
  const { entry, sha, catalog, renewal } = input;
  const day = today();
  const sourceRef = input.sourceUrl ?? permalink(sha ?? 'HEAD', entry.line);

  let merchantUrl: string;
  try {
    merchantUrl = cleanMerchantUrl(entry.url);
  } catch {
    return skip('bad-url');
  }

  const fetched = await ctx.fetcher.page(merchantUrl);
  const upstreamOnly =
    input.curated &&
    (fetched.error === 'empty-text' || fetched.status === 403 || fetched.status === 429);
  const page = upstreamOnly ? { ...fetched, title: null, text: '' } : fetched;
  const snapshotId = await saveSnapshot(ctx, merchantUrl, page);
  if (page.error === 'empty-text') {
    bump(ctx.stats, 'emptyText');
    if (!upstreamOnly) return skip('empty-text');
  }
  if (page.error && !upstreamOnly) {
    const transient = page.status === null || page.status >= 500;
    return transient ? { status: 'retry', reason: page.error } : skip(page.error);
  }

  const known = renewal
    ? catalog.products.find((product) => product.id === renewal.product.id)
    : findKnown(catalog, entry, !input.sourceUrl);
  const slug = known?.slug ?? (slugify(entry.name) || `app-${sha256(entry.name).slice(0, 12)}`);
  const host = hostOf(merchantUrl);
  const websiteOf = () => (isSharedHost(host) ? null : new URL(merchantUrl).origin);

  const extraction = await ctx.extractLlm.json({
    system: extractSystem(Boolean(input.curated)),
    user: extractUser(
      day,
      entry,
      { url: page.url, title: page.title, text: page.text.slice(0, LLM_TEXT_CHARS) },
      { curated: input.curated, renewal: Boolean(renewal) },
    ),
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
        benefitSummary:
          value.deal.offerType === 'discount' || value.deal.offerType === 'lifetime'
            ? null
            : value.deal.benefitSummary,
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
  const upstreamText = renewal ? '' : entry.raw;
  const sources = [
    { url: page.url, text: page.text },
    { url: sourceRef, text: upstreamText },
  ];
  const sourceText = sources.map((s) => s.text).join('\n');
  const notes: string[] = [];
  const pageHost = hostOf(page.url);
  if (
    input.trustedHosts &&
    !isTrustedHost(pageHost, input.trustedHosts) &&
    !(input.curated && pageHost !== null && pageHost === host)
  )
    notes.push('商家域名尚未经独立确认');
  const stripped = stripUnverified(extraction.built.deal, sourceText);
  const dates = checkDates(stripped.deal, new Date(), day);
  notes.push(...stripped.notes, ...dates.notes);
  if (dates.ended) return skip('ended');
  const checked = dealSchema.safeParse(dates.deal);
  if (!checked.success) return skip('unverifiable', z.prettifyError(checked.error).slice(0, 200));
  const deal: Deal = checked.data;
  if (renewal && dealState(deal, new Date()) === 'upcoming') return skip('upcoming');

  const { kept, dropped } = verifyEvidence(extraction.evidence, sources);
  if (!kept.length) return skip('no-verified-evidence');
  let confidence = extraction.confidence - 0.1 * dropped - 0.15 * notes.length;
  if (!input.curated && !kept.some((e) => e.url === page.url))
    confidence = Math.min(confidence, 0.6);
  confidence = Math.round(Math.max(0.05, Math.min(1, confidence)) * 100) / 100;
  if (confidence < MIN_CONFIDENCE) return skip('low-confidence', String(confidence));

  const catalogProduct = known ?? renewal?.product;
  const product: Product = catalogProduct
    ? productSchema.parse(catalogProduct)
    : extraction.built.product;
  const event = renewal?.event.slug ?? pickEvent(catalog.events, deal, day);
  const eventId = renewal?.event.id ?? catalog.events.find((e) => e.slug === event)?.id;
  const existingOffers = known?.offers?.filter((o) => o.eventId === eventId) ?? [];
  const label = extraction.deal?.merchantPlan || '';
  const merchantPlan =
    label &&
    (input.curated ? sourceText : page.text)
      .normalize('NFKC')
      .toLowerCase()
      .includes(label.normalize('NFKC').toLowerCase())
      ? label
      : '';
  if (label && !merchantPlan) notes.push('商家未明确标识该方案');
  let key = offerKeyFor(deal, merchantPlan);
  const matchesLegacy = (
    old: Pick<Deal, 'offerType' | 'billing' | 'code' | 'plan' | 'priceAmount'>,
  ) => {
    const legacyPlan =
      old.plan.zh
        .split(/[·｜|]/)[0]
        ?.trim()
        .toLowerCase() ?? '';
    const samePlan = merchantPlan
      ? legacyPlan.split(/[^\p{L}\p{N}]+/u).includes(merchantPlan.toLowerCase()) ||
        legacyPlan === merchantPlan.toLowerCase()
      : old.plan.zh === deal.plan.zh ||
        (deal.priceAmount !== null && deal.priceAmount === old.priceAmount);
    return (
      samePlan &&
      old.billing === deal.billing &&
      old.code === deal.code &&
      ((old.offerType ?? 'discount') === deal.offerType ||
        ((old.offerType ?? 'discount') === 'discount' && deal.offerType === 'lifetime'))
    );
  };
  const existingOffer = existingOffers.some(
    (o) => o.offerKey === key || (o.offerKey === 'default' && matchesLegacy(o)),
  );
  if (existingOffer && !renewal) return skip('existing-offer');
  const [legacy] = await ctx.db
    .select({ payload: proposals.payload })
    .from(proposals)
    .where(eq(proposals.dedupeKey, `create:${event}:${slug}`));
  const existingProposal = legacy?.payload && matchesLegacy(legacy.payload.deal);
  if (existingOffer || existingProposal) {
    if (!renewal) return skip('existing-proposal');
    // A stable offer identity can recur. Require a later, merchant-quoted window before
    // giving it a new key, since the official page may still show the expired promotion.
    const endedAt = renewal.observedEndedAt ?? renewal.endsAt;
    const zone = renewal.dateZone ?? undefined;
    const endedOn = endedAt ? calendarDay(new Date(endedAt), zone) : renewal.endsOn;
    const gaps = missingMerchantEvidence(deal, [], kept, { url: page.url, text: page.text });
    const newWindow = (['startsAt', 'endsAt', 'startsOn', 'endsOn'] as const).some((field) => {
      const value = deal[field];
      if (!value || gaps.includes(field) || !endedOn) return false;
      if (!field.endsWith('At')) return value > endedOn;
      return endedAt
        ? Date.parse(value) > Date.parse(endedAt)
        : calendarDay(new Date(value), zone) > endedOn;
    });
    if (!newWindow) return skip('existing-offer');
    key = `${key}-renewal-${renewal.id}`;
    if (existingOffers.some((o) => o.offerKey === key)) return skip('existing-offer');
  }
  deal.offerKey = key;
  const evidence: Evidence[] = kept;
  const reason = [
    renewal ? `精选优惠续期复查（原优惠 #${renewal.id}）` : `上游榜单新条目（${entry.section}）`,
    `商家页 ${page.url}`,
    `证据 ${kept.length}/${kept.length + dropped} 条通过原文核对`,
    ...notes,
  ].join('；');

  const filed = await reviewProposal(
    ctx,
    {
      kind: 'create',
      snapshotId,
      auditInputs: {
        merchantUrl: page.url,
        upstreamText,
        dropped,
        notes,
        ...(input.curated ? { sourceTrust: 'curated' as const } : {}),
      },
      payload: { product, event, deal },
      changes: [],
      evidence,
      reason,
      confidence,
      dedupeKey: `create:${event}:${slug}:${deal.offerKey}`,
      sourceRef,
    },
    page.text,
  );
  return { status: 'proposal', filed };
}
