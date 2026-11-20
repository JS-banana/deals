import { and, deals, eq, products, sql } from '@deals/db';
import { z } from 'zod';
import { zodParse } from './llm.ts';
import { TRANSLATE_SYSTEM, translateUser } from './prompts.ts';
import type { Ctx, Job } from './runtime.ts';
import { bump, errorMessage, mapPool } from './util.ts';

const MAX_BATCH_ITEMS = 20;
const MAX_BATCH_CHARS = 5000;

const DEAL_COLUMNS = ['plan', 'terms', 'renewal', 'eligibility', 'cardNote'] as const;

interface Item {
  id: string;
  column: 'summary' | (typeof DEAL_COLUMNS)[number];
  rowId: number;
  /** Context for the model only. */
  product: string;
  zh: string;
}

const responseSchema = z.object({ translations: z.record(z.string(), z.string()) });
const hasCjk = (text: string) => /[\u3400-\u9fff]/.test(text);

/** Why a translation is unusable, or null: numbers and ALL-CAPS codes must survive, no Chinese may leak. */
export function factProblem(item: Pick<Item, 'zh' | 'product'>, en: string): string | null {
  const tokens = [
    // A month number (12 月) legitimately becomes a month name, so it is not checked.
    ...(item.zh.match(/\d[\d.,]*(?![\d.,]*\s*月)/g) ?? []).map((t) => t.replace(/[.,]+$/, '')),
    ...(item.zh.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? []),
  ];
  const lost = tokens.find((token) => !en.includes(token));
  if (lost) return `"${lost}" missing from the English`;
  return hasCjk(en) && !hasCjk(item.product) ? 'Chinese characters left in the English' : null;
}

export const keepsFacts = (item: Pick<Item, 'zh' | 'product'>, en: string) =>
  factProblem(item, en) === null;

async function collect(ctx: Ctx): Promise<Item[]> {
  const items: Item[] = [];
  const empty = (value: { zh: string; en: string } | null) =>
    Boolean(value?.zh) && !value?.en.trim();
  const productRows = await ctx.db.select().from(products);
  for (const p of productRows) {
    if (empty(p.summary)) {
      items.push({
        id: `p${p.id}.summary`,
        column: 'summary',
        rowId: p.id,
        product: p.name,
        zh: p.summary.zh,
      });
    }
  }
  const names = new Map(productRows.map((p) => [p.id, p.name]));
  for (const d of await ctx.db.select().from(deals)) {
    for (const column of DEAL_COLUMNS) {
      const value = d[column];
      if (value && empty(value)) {
        items.push({
          id: `d${d.id}.${column}`,
          column,
          rowId: d.id,
          product: names.get(d.productId) ?? '',
          zh: value.zh,
        });
      }
    }
  }
  return items;
}

function batches(items: Item[]): Item[][] {
  const out: Item[][] = [];
  let current: Item[] = [];
  let chars = 0;
  for (const item of items) {
    if (
      current.length >= MAX_BATCH_ITEMS ||
      (current.length && chars + item.zh.length > MAX_BATCH_CHARS)
    ) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.zh.length;
  }
  if (current.length) out.push(current);
  return out;
}

async function translateBatch(
  ctx: Ctx,
  batch: Item[],
  problems: Map<string, string>,
): Promise<Map<string, string>> {
  const result = await ctx.llm.json({
    system: TRANSLATE_SYSTEM,
    user: translateUser(
      batch.map((i) => ({ id: i.id, field: i.column, product: i.product, zh: i.zh })),
    ),
    parse: zodParse(responseSchema),
  });
  const valid = new Map<string, string>();
  for (const item of batch) {
    const en = result.translations[item.id]?.trim();
    const problem = en ? factProblem(item, en) : 'no translation returned';
    if (en && !problem) valid.set(item.id, en);
    else problems.set(item.id, problem ?? 'empty');
  }
  return valid;
}

/** Write `en` only while it is still empty and zh is unchanged, so concurrent edits are never clobbered. */
async function write(ctx: Ctx, item: Item, en: string) {
  const text = { zh: item.zh, en };
  if (item.column === 'summary') {
    const column = products.summary;
    await ctx.db
      .update(products)
      .set({ summary: text })
      .where(
        and(
          eq(products.id, item.rowId),
          sql`${column} ->> 'en' = '' and ${column} ->> 'zh' = ${item.zh}`,
        ),
      );
  } else {
    const column = deals[item.column];
    await ctx.db
      .update(deals)
      .set({ [item.column]: text })
      .where(
        and(
          eq(deals.id, item.rowId),
          sql`${column} ->> 'en' = '' and ${column} ->> 'zh' = ${item.zh}`,
        ),
      );
  }
}

export const translate: Job = async (ctx) => {
  const all = await collect(ctx);
  const items = ctx.limit ? all.slice(0, ctx.limit) : all;
  ctx.stats.items = items.length;
  ctx.log(`${items.length} fields to translate`);

  const apply = async (item: Item, en: string) => {
    if (ctx.dryRun) ctx.log(`${item.id} (${item.product}): ${item.zh} -> ${en}`);
    else await write(ctx, item, en);
    bump(ctx.stats, 'translated');
  };

  await mapPool(
    batches(items),
    2,
    ctx.signal,
    async (batch) => {
      const problems = new Map<string, string>();
      const valid = await translateBatch(ctx, batch, problems);
      // Retry what the model skipped or got wrong, each field on its own.
      const missing = batch.filter((item) => !valid.has(item.id));
      if (missing.length && batch.length > 1) {
        for (const item of missing) {
          if (ctx.signal.aborted) break;
          const again = await translateBatch(ctx, [item], problems).catch(
            () => new Map<string, string>(),
          );
          for (const [id, en] of again) valid.set(id, en);
        }
      }
      for (const item of batch) {
        const en = valid.get(item.id);
        if (en) await apply(item, en);
        else {
          bump(ctx.stats, 'rejected');
          ctx.log(`${item.id}: translation rejected (${problems.get(item.id)})`);
        }
      }
    },
    (batch, error) => {
      bump(ctx.stats, 'errors');
      ctx.log(`batch of ${batch.length} failed: ${errorMessage(error)}`);
    },
  );
};
