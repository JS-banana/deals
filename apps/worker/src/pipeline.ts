/**
 * Quality pipeline for zh -> en: translate, review against a rubric plus deterministic checks,
 * revise what falls short (twice at most). Nothing here touches the database.
 */
import { z } from 'zod';
import { type GlossaryEntry, glossaryBlock, glossaryIssues, selectGlossary } from './glossary.ts';
import { type Llm, zodParse } from './llm.ts';
import { itemsUser, reviewSystem, reviseSystem, translateSystem } from './prompts.ts';
import { bump, errorMessage, mapPool, type Stats } from './util.ts';

/** A published translation needs at least this score and no deterministic failure. */
export const PUBLISH_SCORE = 70;
/** Below this score (or with a deterministic failure) an item goes through revision. */
export const REVISE_BELOW = 85;
export const MAX_REVISIONS = 2;
/** One request carries at most this many texts or characters of Chinese. */
const MAX_BATCH_ITEMS = 12;
const MAX_BATCH_CHARS = 3500;
// gpt-style reasoning tokens count against the cap, so leave generous room.
const MAX_TOKENS = 16_000;

export interface PipelineOptions {
  review?: boolean;
}

const isFatalProviderError = (error: unknown) =>
  /\bLLM HTTP (401|402|403|429)\b/.test(errorMessage(error));

export interface Source {
  id: string;
  field: string;
  /** Context for the model only. */
  product: string;
  zh: string;
}

export interface Dims {
  fidelity: number;
  terminology: number;
  naturalness: number;
  concision: number;
  formatting: number;
}

export interface Outcome {
  id: string;
  en: string;
  /** Reviewer's overall score, capped by fidelity; 0 when there is no usable English. */
  score: number;
  dims: Dims | null;
  /** Deterministic failures (lost numbers/codes, leaked Chinese, no output): never published. */
  problems: string[];
  /** Glossary terms missing from the English: reported, never blocking. */
  glossary: string[];
  /** The reviewer's concrete issues. */
  issues: string[];
  /** Revision rounds this item went through. */
  revisions: number;
}

const hasCjk = (text: string) => /[\u3400-\u9fff]/.test(text);

function englishQuantities(en: string): number[] {
  const quantity =
    /(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:\s*(?:(thousand|k)|(million|mn|m)|(billion|bn|b))\b)?/gi;
  return Array.from(en.matchAll(quantity), ([, digits, thousand, million, billion]) => {
    const value = Number(digits?.replaceAll(',', ''));
    if (thousand) return value * 1e3;
    if (million) return value * 1e6;
    if (billion) return value * 1e9;
    return value;
  });
}

/** Why a translation is unusable, or null: numbers and ALL-CAPS codes must survive, no Chinese may leak. */
export function factProblem(item: Pick<Source, 'zh' | 'product'>, en: string): string | null {
  const scaled = /(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*([万亿])/g;
  const quantities = [...item.zh.matchAll(scaled)];
  if (quantities.length) {
    const values = englishQuantities(en);
    for (const [text, digits, unit] of quantities) {
      const expected = Number(digits?.replaceAll(',', '')) * (unit === '万' ? 1e4 : 1e8);
      if (!values.some((value) => Math.abs(value - expected) <= expected * 1e-6)) {
        return `"${text}" missing from the English`;
      }
    }
  }
  const unscaled = item.zh.replace(scaled, '$2');
  const tokens = [
    // A month number (12 月) legitimately becomes a month name, so it is not checked.
    ...(unscaled.match(/\d[\d.,]*(?![\d.,]*\s*月)/g) ?? []).map((t) => t.replace(/[.,]+$/, '')),
    ...(item.zh.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? []),
  ];
  const lost = tokens.find((token) => !en.includes(token));
  if (lost) return `"${lost}" missing from the English`;
  return hasCjk(en) && !hasCjk(item.product) ? 'Chinese characters left in the English' : null;
}

/** The publish rule: usable English, no deterministic failure, score high enough. */
export const publishable = (o: Pick<Outcome, 'en' | 'problems' | 'score'>): boolean =>
  o.en !== '' && o.problems.length === 0 && o.score >= PUBLISH_SCORE;

export const needsRevision = (o: Pick<Outcome, 'problems' | 'score'>): boolean =>
  o.problems.length > 0 || o.score < REVISE_BELOW;

/** Every finding about an outcome, as stored with the translation. */
export const allIssues = (o: Outcome): string[] => [...o.problems, ...o.glossary, ...o.issues];

/** Keep the version that passes the deterministic checks, then the higher score; ties keep the earlier one. */
function better(candidate: Outcome, current: Outcome | undefined): boolean {
  if (!current) return true;
  const [a, b] = [candidate.problems.length === 0, current.problems.length === 0];
  if (a !== b) return a;
  return candidate.score > current.score;
}

const rating = z.number().min(0).max(100);
const reviewSchema = z.object({
  reviews: z.record(
    z.string(),
    z.object({
      fidelity: rating,
      terminology: rating,
      naturalness: rating,
      concision: rating,
      formatting: rating,
      score: rating,
      issues: z.array(z.string()).catch([]),
    }),
  ),
});
const translationsSchema = z.object({ translations: z.record(z.string(), z.string()) });

/** Reject a response that skips ids, so the client's repair round asks the model for the rest. */
function requireIds<T extends Record<string, unknown>>(ids: string[], map: T, what: string): void {
  const missing = ids.filter((id) => !(id in map));
  if (missing.length) throw new Error(`${what} missing for ids: ${missing.join(', ')}`);
}

const parseTranslations = (ids: string[]) => (raw: unknown) => {
  const value = zodParse(translationsSchema)(raw);
  requireIds(ids, value.translations, 'translations');
  return value.translations;
};

/** An English draft for a source; `error` is set when no draft could be produced. */
interface Draft {
  source: Source;
  en: string;
  error?: string;
}

interface Ctx {
  llm: Llm;
  stats: Stats;
  signal: AbortSignal;
}

/**
 * Run one pipeline stage over `items` in batches (bounded by item count and characters), three
 * batches at a time. If a batch call fails (truncation, repeated bad JSON) its items are retried
 * one by one; an item that still fails becomes `onFail(item, error)`. Results keep input order.
 */
async function stage<T extends { source: Source }, R>(
  ctx: Ctx,
  items: T[],
  run: (batch: T[]) => Promise<R[]>,
  onFail: (item: T, error: unknown) => R,
): Promise<R[]> {
  const out = new Map<T, R>();
  const batches: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    const size = item.source.zh.length;
    if (current.length >= MAX_BATCH_ITEMS || (current.length && chars + size > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length) batches.push(current);

  await mapPool(
    batches,
    3,
    ctx.signal,
    async (batch) => {
      const results = await run(batch).catch(async (error) => {
        if (ctx.signal.aborted) throw error;
        if (batch.length === 1 || isFatalProviderError(error)) {
          return batch.map((item) => onFail(item, error));
        }
        const single: R[] = [];
        for (const item of batch) {
          single.push(...(await run([item]).catch((e) => [onFail(item, e)])));
        }
        return single;
      });
      batch.forEach((item, i) => {
        const result = results[i];
        if (result !== undefined) out.set(item, result);
      });
    },
    () => {},
  );
  return items.flatMap((item) => (out.has(item) ? [out.get(item) as R] : []));
}

async function translateStep(ctx: Ctx, batch: Source[]): Promise<Draft[]> {
  bump(ctx.stats, 'req:translate');
  bump(ctx.stats, 'items:translate', batch.length);
  const glossary = glossaryBlock(selectGlossary(batch.map((s) => s.zh)));
  const translations = await ctx.llm.json({
    system: translateSystem(glossary),
    user: itemsUser(batch),
    reasoningEffort: 'low',
    maxTokens: MAX_TOKENS,
    parse: parseTranslations(batch.map((s) => s.id)),
  });
  return batch.map((source) => ({ source, en: translations[source.id]?.trim() ?? '' }));
}

async function reviseStep(
  ctx: Ctx,
  batch: Array<{ source: Source; current: string; feedback: string[] }>,
): Promise<Draft[]> {
  bump(ctx.stats, 'req:revise');
  bump(ctx.stats, 'items:revise', batch.length);
  const glossary = glossaryBlock(selectGlossary(batch.map((i) => i.source.zh)));
  const translations = await ctx.llm.json({
    system: reviseSystem(glossary),
    user: itemsUser(batch.map((i) => ({ ...i.source, current: i.current, issues: i.feedback }))),
    reasoningEffort: 'medium',
    maxTokens: MAX_TOKENS,
    parse: parseTranslations(batch.map((i) => i.source.id)),
  });
  return batch.map(({ source }) => ({ source, en: translations[source.id]?.trim() ?? '' }));
}

const unreviewed = (draft: Draft, error: string): Outcome => ({
  id: draft.source.id,
  en: draft.en,
  score: 0,
  dims: null,
  problems: [error],
  glossary: [],
  issues: [],
  revisions: 0,
});

async function reviewStep(ctx: Ctx, batch: Draft[]): Promise<Outcome[]> {
  const entries: readonly GlossaryEntry[] = selectGlossary(batch.map((d) => d.source.zh));
  const checked = batch.map((draft) => {
    const problem = draft.en
      ? factProblem(draft.source, draft.en)
      : (draft.error ?? 'no translation returned');
    return {
      draft,
      problems: problem ? [problem] : [],
      glossary: draft.en ? glossaryIssues(draft.source.zh, draft.en, entries) : [],
    };
  });
  const toReview = checked.filter((c) => c.draft.en);
  let reviews: Record<string, z.infer<typeof reviewSchema>['reviews'][string]> = {};
  if (toReview.length) {
    bump(ctx.stats, 'req:review');
    bump(ctx.stats, 'items:review', toReview.length);
    reviews = await ctx.llm.json({
      system: reviewSystem(glossaryBlock(entries)),
      user: itemsUser(
        toReview.map((c) => ({
          ...c.draft.source,
          en: c.draft.en,
          checks: [...c.problems, ...c.glossary],
        })),
      ),
      reasoningEffort: 'medium',
      maxTokens: MAX_TOKENS,
      parse: (raw) => {
        const value = zodParse(reviewSchema)(raw);
        requireIds(
          toReview.map((c) => c.draft.source.id),
          value.reviews,
          'reviews',
        );
        return value.reviews;
      },
    });
  }
  return checked.map(({ draft, problems, glossary }) => {
    const r = reviews[draft.source.id];
    return {
      id: draft.source.id,
      en: draft.en,
      score: r ? Math.round(Math.min(r.score, r.fidelity)) : 0,
      dims: r
        ? {
            fidelity: r.fidelity,
            terminology: r.terminology,
            naturalness: r.naturalness,
            concision: r.concision,
            formatting: r.formatting,
          }
        : null,
      problems,
      glossary,
      issues: r?.issues ?? [],
      revisions: 0,
    };
  });
}

function evaluateDeterministic(batch: Draft[]): Outcome[] {
  const entries: readonly GlossaryEntry[] = selectGlossary(batch.map((d) => d.source.zh));
  return batch.map((draft) => {
    const problem = draft.en
      ? factProblem(draft.source, draft.en)
      : (draft.error ?? 'no translation returned');
    const problems = problem ? [problem] : [];
    const glossary = draft.en ? glossaryIssues(draft.source.zh, draft.en, entries) : [];
    return {
      id: draft.source.id,
      en: draft.en,
      score: draft.en && problems.length === 0 ? 90 : 0,
      dims: null,
      problems,
      glossary,
      issues: [],
      revisions: 0,
    };
  });
}

/**
 * Translate, evaluate and optionally review/revise `sources`. By default runs a single-pass
 * deterministic check (0 extra LLM calls unless a number/code fails factProblem); pass
 * `{ review: true }` to enable full LLM rubric review and up to `MAX_REVISIONS` rounds.
 */
export async function runPipeline(
  llm: Llm,
  stats: Stats,
  signal: AbortSignal,
  sources: Source[],
  options: PipelineOptions = {},
): Promise<Outcome[]> {
  const ctx: Ctx = { llm, stats, signal };
  const bySource = new Map(sources.map((s) => [s.id, s]));
  let pending: Draft[] = await stage(
    ctx,
    sources.map((source) => ({ source })),
    (batch) =>
      translateStep(
        ctx,
        batch.map((b) => b.source),
      ),
    (item, error) => ({
      source: item.source,
      en: '',
      error: `translation failed: ${errorMessage(error)}`,
    }),
  );

  const best = new Map<string, Outcome>();
  const rounds = new Map<string, number>();

  if (!options.review) {
    const initial = evaluateDeterministic(pending);
    for (const outcome of initial) best.set(outcome.id, outcome);
    const redo = initial.filter((o) => o.en !== '' && o.problems.length > 0);
    if (redo.length && !signal.aborted) {
      for (const o of redo) rounds.set(o.id, 1);
      const revised = await stage(
        ctx,
        redo.map((o) => ({
          source: bySource.get(o.id) as Source,
          current: o.en,
          feedback: o.problems,
        })),
        (batch) => reviseStep(ctx, batch),
        (item) => ({ source: item.source, en: '', error: 'revision failed' }),
      );
      for (const outcome of evaluateDeterministic(revised.filter((d) => d.en))) {
        if (better(outcome, best.get(outcome.id))) best.set(outcome.id, outcome);
      }
    }
    return sources.map((source) => ({
      ...(best.get(source.id) ??
        unreviewed({ source, en: '' }, signal.aborted ? 'aborted' : 'no translation returned')),
      revisions: rounds.get(source.id) ?? 0,
    }));
  }

  for (let round = 0; pending.length; round++) {
    const reviewed = await stage(
      ctx,
      pending,
      (batch) => reviewStep(ctx, batch),
      (draft, error) => unreviewed(draft, `review failed: ${errorMessage(error)}`),
    );
    for (const outcome of reviewed) {
      if (better(outcome, best.get(outcome.id))) best.set(outcome.id, outcome);
    }
    // Revise the best version so far, not the latest: a worse rewrite must not replace it.
    const redo = [...new Set(reviewed.map((o) => o.id))].flatMap((id) => {
      const base = best.get(id);
      return base &&
        needsRevision(base) &&
        !(base.en === '' && base.problems.some((p) => p.startsWith('translation failed:')))
        ? [base]
        : [];
    });
    if (!redo.length || round >= MAX_REVISIONS || signal.aborted) break;
    for (const o of redo) rounds.set(o.id, round + 1);
    pending = await stage(
      ctx,
      redo.map((o) => ({
        source: bySource.get(o.id) as Source,
        current: o.en,
        feedback: [...o.problems, ...o.issues],
      })),
      (batch) => reviseStep(ctx, batch),
      // A failed revision leaves the best version so far in place.
      (item) => ({ source: item.source, en: '', error: 'revision failed' }),
    );
    pending = pending.filter((draft) => draft.en);
  }
  return sources.map((source) => ({
    ...(best.get(source.id) ??
      unreviewed({ source, en: '' }, signal.aborted ? 'aborted' : 'no translation returned')),
    revisions: rounds.get(source.id) ?? 0,
  }));
}
