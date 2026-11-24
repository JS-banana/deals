/**
 * The only writer of English. Each zh field is translated once, kept in the `translations`
 * memory (keyed by the hash of its zh), and redone only when its zh changes.
 */
import type { Deal, Localized, Product } from '@deals/core';
import { and, deals, eq, inArray, products, translations } from '@deals/db';
import { GLOSSARY_VERSION } from './glossary.ts';
import {
  allIssues,
  type Outcome,
  PUBLISH_SCORE,
  publishable,
  REVISE_BELOW,
  runPipeline,
  type Source,
} from './pipeline.ts';
import { PROMPT_VERSION } from './prompts.ts';
import type { Ctx, Job } from './runtime.ts';
import { bump, errorMessage, sha256 } from './util.ts';

const DEFAULT_SAMPLE = 15;

const DEAL_COLUMNS = [
  'plan',
  'terms',
  'renewal',
  'eligibility',
  'cardNote',
  'benefitSummary',
  'howToClaim',
] as const;

interface Field {
  id: string;
  column: 'summary' | (typeof DEAL_COLUMNS)[number];
  rowId: number;
  /** Context for the model only. */
  product: string;
  value: Localized;
  hash: string;
}

/** Whitespace and Unicode form never change the meaning, so they must not change the key. */
export const normalizeSource = (zh: string): string =>
  zh.normalize('NFC').replace(/\s+/g, ' ').trim();
export const sourceHash = (zh: string): string => sha256(normalizeSource(zh));

type Memory = Pick<typeof translations.$inferSelect, 'targetText' | 'score'>;
export type Action = 'fresh' | 'keep' | 'reuse' | 'translate';

/**
 * What a field needs. `tm` is the memory row for hash(zh); `producedFor` holds the source hashes
 * of every memory row whose English equals this field's `en`.
 * - en empty, or en we produced for another (older) zh, or `refresh`ed human text: use the memory
 *   hit if it is good enough, else translate.
 * - en equal to the memory text for this zh: fresh.
 * - any other non-empty en was written by a human or before the memory existed: keep.
 */
export function decide(
  field: { hash: string; en: string },
  tm: Memory | undefined,
  producedFor: ReadonlySet<string> | undefined,
  refresh: boolean,
): Action {
  const en = field.en.trim();
  if (en && tm?.targetText === en) return 'fresh';
  const stale = [...(producedFor ?? [])].some((hash) => hash !== field.hash);
  if (en && !stale && !refresh) return 'keep';
  return tm && tm.score >= PUBLISH_SCORE ? 'reuse' : 'translate';
}

async function collect(ctx: Ctx): Promise<Field[]> {
  const fields: Field[] = [];
  const add = (field: Omit<Field, 'hash' | 'id'>, id: string) => {
    if (field.value.zh.trim()) fields.push({ ...field, id, hash: sourceHash(field.value.zh) });
  };
  const productRows = await ctx.db.select().from(products);
  for (const p of productRows) {
    add({ column: 'summary', rowId: p.id, product: p.name, value: p.summary }, `p${p.id}.summary`);
  }
  const names = new Map(productRows.map((p) => [p.id, p.name]));
  for (const d of await ctx.db.select().from(deals)) {
    for (const column of DEAL_COLUMNS) {
      const value = d[column];
      if (value)
        add(
          { column, rowId: d.id, product: names.get(d.productId) ?? '', value },
          `d${d.id}.${column}`,
        );
    }
  }
  return fields;
}

async function loadMemory(ctx: Ctx, fields: Field[]) {
  const pair = and(eq(translations.sourceLang, 'zh'), eq(translations.targetLang, 'en'));
  const hashes = [...new Set(fields.map((f) => f.hash))];
  const texts = [...new Set(fields.map((f) => f.value.en.trim()).filter(Boolean))];
  const rows = hashes.length
    ? await ctx.db
        .select()
        .from(translations)
        .where(and(pair, inArray(translations.sourceHash, hashes)))
    : [];
  const produced = texts.length
    ? await ctx.db
        .select({ hash: translations.sourceHash, text: translations.targetText })
        .from(translations)
        .where(and(pair, inArray(translations.targetText, texts)))
    : [];
  const byHash = new Map(rows.map((r) => [r.sourceHash, r]));
  const producedFor = new Map<string, Set<string>>();
  for (const { hash, text } of produced) {
    producedFor.set(text, (producedFor.get(text) ?? new Set()).add(hash));
  }
  return { byHash, producedFor };
}

/** Write `en` only while the field is still exactly what we read, so concurrent edits are never clobbered. */
async function write(ctx: Ctx, field: Field, en: string) {
  const next = { zh: field.value.zh, en };
  if (field.column === 'summary') {
    await ctx.db
      .update(products)
      .set({ summary: next })
      .where(and(eq(products.id, field.rowId), eq(products.summary, field.value)));
  } else {
    await ctx.db
      .update(deals)
      .set({ [field.column]: next })
      .where(and(eq(deals.id, field.rowId), eq(deals[field.column], field.value)));
  }
}

/** A distinct zh text: one model call covers every field that carries it. */
interface Group {
  hash: string;
  /** How many fields carry this text. */
  count: number;
  /** First carrier, for logs. */
  label: string;
  source: Source;
}

interface Text {
  zh: string;
  field: string;
  product: string;
  label?: string;
}

const textOf = (field: Field): Text => ({
  zh: field.value.zh,
  field: field.column,
  product: field.product,
  label: field.id,
});

/** One group per distinct zh text; the model sees the first few product names as context. */
function group(texts: Text[]): Group[] {
  const byHash = new Map<string, Text[]>();
  for (const text of texts) {
    const hash = sourceHash(text.zh);
    byHash.set(hash, [...(byHash.get(hash) ?? []), text]);
  }
  return [...byHash.entries()].map(([hash, members], index) => {
    const [first] = members as [Text, ...Text[]];
    const product = [...new Set(members.map((m) => m.product))].slice(0, 3).join(' / ');
    return {
      hash,
      count: members.length,
      label: first.label ?? first.field,
      source: { id: `t${index + 1}`, field: first.field, product, zh: first.zh },
    };
  });
}

/** Texts handled per pipeline run, so a long backlog is saved progressively and survives a restart. */
const CHUNK = 40;

/** Run the pipeline over groups chunk by chunk; each stage batches several texts per request. */
async function runGroups(
  ctx: Ctx,
  groups: Group[],
  onOutcome: (group: Group, outcome: Outcome) => Promise<void>,
  review = ctx.config.translateReview,
) {
  const byId = new Map(groups.map((g) => [g.source.id, g]));
  for (let i = 0; i < groups.length && !ctx.signal.aborted; i += CHUNK) {
    const chunk = groups.slice(i, i + CHUNK);
    try {
      const outcomes = await runPipeline(
        ctx.translateLlm,
        ctx.stats,
        ctx.signal,
        chunk.map((g) => g.source),
        { review },
      );
      for (const outcome of outcomes) {
        const g = byId.get(outcome.id);
        if (g) await onOutcome(g, outcome);
      }
    } catch (error) {
      bump(ctx.stats, 'errors');
      ctx.log(`chunk of ${chunk.length} failed: ${errorMessage(error)}`);
    }
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * English for each distinct text, keyed by source hash. A usable memory row is returned without
 * any model call; the rest goes through the quality pipeline and, when publishable, is stored in
 * the memory. Texts that fail the publish rule are absent from the result. Writes no fields.
 * `limit` caps how many distinct texts are sent to the model.
 */
async function resolveTexts(ctx: Ctx, texts: Text[], limit?: number): Promise<Map<string, string>> {
  const groups = group(texts);
  const resolved = new Map<string, string>();
  if (!groups.length) return resolved;
  const memory = await ctx.db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.sourceLang, 'zh'),
        eq(translations.targetLang, 'en'),
        inArray(
          translations.sourceHash,
          groups.map((g) => g.hash),
        ),
      ),
    );
  const usable = new Map(
    memory
      .filter((row) => row.score >= PUBLISH_SCORE)
      .map((row) => [row.sourceHash, row.targetText]),
  );
  const todo: Group[] = [];
  for (const g of groups) {
    const hit = usable.get(g.hash);
    if (hit) {
      resolved.set(g.hash, hit);
      bump(ctx.stats, 'tmHits', g.count);
    } else todo.push(g);
  }

  await runGroups(ctx, limit ? todo.slice(0, limit) : todo, async (g, outcome) => {
    bump(ctx.stats, 'scored');
    bump(ctx.stats, 'scoreTotal', outcome.score);
    if (outcome.revisions) bump(ctx.stats, 'revised');
    if (!publishable(outcome)) {
      bump(ctx.stats, 'failed');
      ctx.log(
        `${g.label}: not published (score ${outcome.score}): ${allIssues(outcome).join('; ') || 'no English'}`,
      );
      return;
    }
    if (!ctx.dryRun) {
      const row = {
        sourceLang: 'zh',
        targetLang: 'en',
        sourceHash: g.hash,
        sourceText: g.source.zh,
        targetText: outcome.en,
        model: ctx.config.translate.model ?? '',
        promptVersion: PROMPT_VERSION,
        glossaryVersion: GLOSSARY_VERSION,
        score: outcome.score,
        issues: allIssues(outcome),
      };
      await ctx.db
        .insert(translations)
        .values(row)
        .onConflictDoUpdate({
          target: [translations.sourceLang, translations.targetLang, translations.sourceHash],
          set: row,
        });
    }
    resolved.set(g.hash, outcome.en);
    bump(ctx.stats, 'translated');
    // The same text in other fields is served from the memory entry just made.
    bump(ctx.stats, 'tmHits', g.count - 1);
  });
  if (ctx.stats.scored)
    ctx.stats.meanScore = round1((ctx.stats.scoreTotal ?? 0) / ctx.stats.scored);
  return resolved;
}

/**
 * Fill the empty English of a proposal payload before it is filed, so approving it publishes both
 * languages at once. Never throws and never blocks: what cannot be translated stays '' and the
 * hourly job retries it after approval. Skipped on dry runs (it would spend tokens for nothing).
 */
export async function translatePayload(
  ctx: Ctx,
  product: Product,
  deal: Deal,
  changedDealFields?: readonly string[],
): Promise<{ product: Product; deal: Deal }> {
  const todo: Array<{ column: Field['column']; value: Localized }> = [];
  // Updates may patch only their reviewed fields. Keep all other published translations intact.
  if (!changedDealFields && product.summary.zh.trim() && !product.summary.en.trim())
    todo.push({ column: 'summary', value: product.summary });
  const columns = changedDealFields
    ? DEAL_COLUMNS.filter((column) => changedDealFields.includes(column))
    : DEAL_COLUMNS;
  for (const column of columns) {
    const value = deal[column];
    if (value?.zh.trim() && !value.en.trim()) todo.push({ column, value });
  }
  if (!todo.length || ctx.dryRun) return { product, deal };
  try {
    const resolved = await resolveTexts(
      ctx,
      todo.map(({ column, value }) => ({
        zh: value.zh,
        field: column,
        product: product.name,
        label: `${product.slug}.${column}`,
      })),
    );
    const fill = (value: Localized): Localized => ({
      zh: value.zh,
      en: value.en.trim() ? value.en : (resolved.get(sourceHash(value.zh)) ?? ''),
    });
    const filled = { ...deal };
    for (const column of columns) {
      const value = deal[column];
      if (value) Object.assign(filled, { [column]: fill(value) });
    }
    return {
      product: changedDealFields ? product : { ...product, summary: fill(product.summary) },
      deal: filled,
    };
  } catch (error) {
    ctx.log(`${product.slug}: translation skipped: ${errorMessage(error)}`);
    return { product, deal };
  }
}

let running = false;

export const translate: Job = async (ctx) => {
  // The hourly schedule and the daily run could overlap; a second run would only spend tokens twice.
  if (running) return ctx.log('another translate run is in progress, skipping');
  running = true;
  try {
    await run(ctx);
  } finally {
    running = false;
  }
};

async function run(ctx: Ctx) {
  const fields = await collect(ctx);
  const { byHash, producedFor } = await loadMemory(ctx, fields);
  ctx.stats.fields = fields.length;

  const needing: Field[] = [];
  for (const field of fields) {
    const action = decide(
      { hash: field.hash, en: field.value.en },
      byHash.get(field.hash),
      producedFor.get(field.value.en.trim()),
      ctx.refresh ?? false,
    );
    if (action === 'reuse' || action === 'translate') needing.push(field);
    else bump(ctx.stats, action === 'fresh' ? 'fresh' : 'kept');
  }
  ctx.log(
    `${fields.length} fields: ${ctx.stats.fresh ?? 0} fresh, ${ctx.stats.kept ?? 0} kept, ${needing.length} need English`,
  );
  if (!needing.length) return;

  const resolved = await resolveTexts(ctx, needing.map(textOf), ctx.limit);
  for (const field of needing) {
    const en = resolved.get(field.hash);
    if (!en) continue;
    if (ctx.dryRun) ctx.log(`${field.id} (${field.product}): ${field.value.zh} -> ${en}`);
    else await write(ctx, field, en);
  }
}

/** `translate-eval`: run the full pipeline on a deterministic sample without writing anything. */
export const translateEval: Job = async (ctx) => {
  const fields = await collect(ctx);
  const distinct = [...new Map(fields.map((f) => [f.hash, f])).values()].sort(
    (a, b) => a.value.zh.length - b.value.zh.length || a.hash.localeCompare(b.hash),
  );
  const size = Math.min(ctx.sample ?? DEFAULT_SAMPLE, distinct.length);
  // Evenly spaced over the length-sorted list: short labels through long terms, every field kind.
  const sample = Array.from(
    { length: size },
    (_, i) => distinct[Math.floor(((i + 0.5) * distinct.length) / size)] as Field,
  );
  const groups = group(sample.map(textOf));
  const old = new Map(sample.map((f) => [f.hash, f.value.en]));
  const outcomes: Array<{ group: Group; outcome: Outcome }> = [];
  ctx.log(
    `evaluating ${groups.length} of ${distinct.length} distinct texts with ${ctx.config.translate.model}`,
  );
  await runGroups(
    ctx,
    groups,
    async (g, outcome) => {
      outcomes.push({ group: g, outcome });
    },
    true,
  );
  outcomes.sort((a, b) => a.group.source.zh.length - b.group.source.zh.length);

  for (const { group: g, outcome: o } of outcomes) {
    const d = o.dims;
    const dims = d
      ? ` (fidelity ${d.fidelity}, terminology ${d.terminology}, naturalness ${d.naturalness}, concision ${d.concision}, formatting ${d.formatting})`
      : '';
    ctx.log(
      [
        `[${g.label}] ${g.source.product} · score ${o.score}${dims} · revisions ${o.revisions}`,
        `  zh : ${g.source.zh}`,
        `  old: ${old.get(g.hash) || '(empty)'}`,
        `  en : ${o.en || '(none)'}`,
        ...allIssues(o).map((issue) => `  ! ${issue}`),
      ].join('\n'),
    );
  }

  const n = outcomes.length;
  const mean = (pick: (o: Outcome) => number) =>
    n ? round1(outcomes.reduce((sum, { outcome }) => sum + pick(outcome), 0) / n) : 0;
  const count = (test: (o: Outcome) => boolean) =>
    outcomes.filter(({ outcome }) => test(outcome)).length;
  const goodShare = n ? round1((100 * count((o) => o.score >= REVISE_BELOW)) / n) : 0;
  Object.assign(ctx.stats, {
    items: n,
    meanScore: mean((o) => o.score),
    pctAtLeast85: goodShare,
    publishable: count(publishable),
    deterministicFailures: count((o) => o.problems.length > 0),
    glossaryMisses: outcomes.reduce((sum, { outcome }) => sum + outcome.glossary.length, 0),
    revised: count((o) => o.revisions > 0),
  });
  const dimMean = (key: keyof NonNullable<Outcome['dims']>) => mean((o) => o.dims?.[key] ?? 0);
  ctx.log(
    `aggregate: n=${n} mean score ${mean((o) => o.score)}, ${goodShare}% >= ${REVISE_BELOW}, ` +
      `publishable ${count(publishable)}/${n}, deterministic failures ${count((o) => o.problems.length > 0)}, ` +
      `glossary misses ${ctx.stats.glossaryMisses}, revised ${count((o) => o.revisions > 0)}; ` +
      `mean fidelity ${dimMean('fidelity')}, terminology ${dimMean('terminology')}, naturalness ${dimMean('naturalness')}, ` +
      `concision ${dimMean('concision')}, formatting ${dimMean('formatting')} (tokens are in the stats line)`,
  );
};
