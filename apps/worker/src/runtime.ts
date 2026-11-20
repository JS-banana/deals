import { calendarDay } from '@deals/core';
import { createDb, type Db, eq, pageSnapshots, pipelineRuns } from '@deals/db';
import { createFetcher, type Fetcher, type Page } from './fetcher.ts';
import { createLlm, type Llm, type LlmConfig } from './llm.ts';
import { errorMessage, type Stats } from './util.ts';

export interface Config {
  databaseUrl: string | undefined;
  mediaDir: string | undefined;
  githubToken: string | undefined;
  /** Extraction and recheck. */
  llm: LlmConfig;
  /** Translation: TRANSLATE_* when all three are set, otherwise the same provider as `llm`. */
  translate: LlmConfig;
}

// Reasoning models can think for minutes before answering a batch.
const TRANSLATE_TIMEOUT_MS = 240_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let extraBody: Record<string, unknown> = { thinking: { type: 'disabled' } };
  if (env.LLM_EXTRA_BODY) extraBody = JSON.parse(env.LLM_EXTRA_BODY);
  const llm: LlmConfig = {
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    extraBody,
  };
  // All three or nothing: never pair one provider's URL with another's key.
  const own = Boolean(env.TRANSLATE_BASE_URL && env.TRANSLATE_API_KEY && env.TRANSLATE_MODEL);
  const translate: LlmConfig = own
    ? {
        baseUrl: env.TRANSLATE_BASE_URL,
        apiKey: env.TRANSLATE_API_KEY,
        model: env.TRANSLATE_MODEL,
        extraBody: env.TRANSLATE_EXTRA_BODY ? JSON.parse(env.TRANSLATE_EXTRA_BODY) : {},
        timeoutMs: TRANSLATE_TIMEOUT_MS,
      }
    : { ...llm, timeoutMs: TRANSLATE_TIMEOUT_MS };
  return {
    databaseUrl: env.DATABASE_URL,
    mediaDir: env.MEDIA_DIR,
    githubToken: env.GITHUB_TOKEN || undefined,
    llm,
    translate,
  };
}

export interface JobOptions {
  limit?: number | undefined;
  dryRun: boolean;
  /** translate: also redo English that was not produced by the translation memory. */
  refresh?: boolean | undefined;
  /** translate-eval: sample size. */
  sample?: number | undefined;
}

/** Everything a job needs; one per job run so stats and rate limits do not leak across jobs. */
export interface Ctx extends JobOptions {
  job: string;
  db: Db;
  config: Config;
  signal: AbortSignal;
  stats: Stats;
  extractLlm: Llm;
  translateLlm: Llm;
  fetcher: Fetcher;
  log: (message: string) => void;
}

export type Job = (ctx: Ctx) => Promise<void>;

export interface Runtime {
  db: Db;
  config: Config;
  signal: AbortSignal;
}

export const today = () => calendarDay(new Date());

export function log(job: string, message: string) {
  console.log(`${new Date().toISOString()} [${job}] ${message}`);
}

export function createRuntime(signal: AbortSignal): Runtime {
  const config = loadConfig();
  return { db: createDb(config.databaseUrl), config, signal };
}

/**
 * Run a job inside a `pipeline_runs` row. Never throws: a failure is recorded and returned so
 * callers (`daily`, `schedule`) can carry on with the next job. Dry runs are not recorded.
 */
export async function runJob(
  rt: Runtime,
  name: string,
  options: JobOptions,
  job: Job,
): Promise<{ ok: boolean; stats: Stats }> {
  const stats: Stats = {};
  const write = (message: string) => log(name, message);
  const ctx: Ctx = {
    ...options,
    job: name,
    db: rt.db,
    config: rt.config,
    signal: rt.signal,
    stats,
    extractLlm: createLlm(rt.config.llm, stats, rt.signal),
    translateLlm: createLlm(rt.config.translate, stats, rt.signal, 3),
    fetcher: createFetcher(rt.signal),
    log: write,
  };
  let runId: number | null = null;
  if (!options.dryRun) {
    const [row] = await rt.db
      .insert(pipelineRuns)
      .values({ job: name })
      .returning({ id: pipelineRuns.id });
    runId = row?.id ?? null;
  }
  write(`start${options.dryRun ? ' (dry run)' : ''}`);
  let error: string | null = null;
  try {
    await job(ctx);
    if (rt.signal.aborted) error = 'aborted';
  } catch (e) {
    error = errorMessage(e);
    write(`failed: ${error}`);
  }
  const ok = error === null;
  write(`${ok ? 'done' : 'stopped'} ${JSON.stringify(stats)}`);
  if (runId !== null) {
    await rt.db
      .update(pipelineRuns)
      .set({ finishedAt: new Date(), ok, stats, error })
      .where(eq(pipelineRuns.id, runId))
      .catch((e) => write(`could not record run: ${errorMessage(e)}`));
  }
  return { ok, stats };
}

/** Store a fetch result under the URL we asked for. Returns the snapshot id (null on a dry run). */
export async function saveSnapshot(
  ctx: Ctx,
  url: string,
  page: Page,
  keepText = true,
): Promise<number | null> {
  if (ctx.dryRun) return null;
  const [row] = await ctx.db
    .insert(pageSnapshots)
    .values({
      url,
      httpStatus: page.status,
      contentHash: page.hash,
      title: page.title,
      text: keepText && page.text ? page.text : null,
      error: page.error,
    })
    .returning({ id: pageSnapshots.id });
  return row?.id ?? null;
}
