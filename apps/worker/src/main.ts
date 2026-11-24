import { Cron } from 'croner';
import { auditEval } from './audit-eval.ts';
import { indexNow } from './indexnow.ts';
import { logos } from './logos.ts';
import { digest, notifyOffers } from './notify.ts';
import { prune } from './prune.ts';
import { recheck } from './recheck.ts';
import { reviewPending } from './review-pending.ts';
import { createRuntime, type Job, type JobOptions, log, type Runtime, runJob } from './runtime.ts';
import { syncSources } from './sources/sync.ts';
import { translate, translateEval } from './translate.ts';

const JOBS: Record<string, Job> = {
  translate,
  'translate-eval': translateEval,
  'audit-eval': auditEval,
  'review-pending': reviewPending,
  logos,
  'sync-upstream': syncSources('upstream'),
  'sync-fast': syncSources('fast'),
  'sync-slow': syncSources('slow'),
  recheck,
  indexnow: indexNow,
  prune,
  digest,
  'notify-offers': notifyOffers,
};

const USAGE = `usage: node src/main.ts <translate|translate-eval|audit-eval|review-pending|logos|sync-upstream|sync-fast|sync-slow|recheck|indexnow|prune|digest|notify-offers|daily|schedule> [--limit N] [--dry-run]
  translate [--limit N] [--refresh] [--dry-run]
  translate-eval | audit-eval [--sample N]`;

/** Each daily stage records its outcome before the next stage starts. */
async function daily(rt: Runtime, options: JobOptions) {
  const results = await runJob(rt, 'daily', options, async (ctx) => {
    for (const name of ['translate', 'logos', 'sync-slow', 'recheck', 'prune', 'digest']) {
      if (rt.signal.aborted) break;
      const job = JOBS[name];
      if (!job) continue;
      const { ok, stats } = await runJob(rt, name, options, job).catch(() => ({
        ok: false,
        stats: { errors: 1 },
      }));
      ctx.stats[name] = ok ? 1 : 0;
      if (!ok || stats.errors) ctx.stats.failedJobs = (ctx.stats.failedJobs ?? 0) + 1;
    }
  });
  return results.ok && !results.stats.failedJobs;
}

async function runNamed(rt: Runtime, name: string, options: JobOptions): Promise<boolean> {
  if (name === 'daily') return daily(rt, options);
  const job = JOBS[name];
  if (!job) throw new Error(`unknown job "${name}"\n${USAGE}`);
  const { ok, stats } = await runJob(rt, name, options, job);
  return ok && (!name.startsWith('sync-') || !stats.errors);
}

async function schedule(rt: Runtime) {
  const timezone = 'Asia/Shanghai';
  const running = new Set<Promise<unknown>>();
  const track = (name: string) => async () => {
    if (rt.signal.aborted) return;
    const run = runNamed(rt, name, { dryRun: false }).catch((e) =>
      log('schedule', `${name} crashed: ${e}`),
    );
    running.add(run);
    try {
      await run;
    } finally {
      running.delete(run);
    }
  };
  const crons = [
    new Cron('10 6 * * *', { timezone, protect: true, name: 'daily' }, track('daily')),
    new Cron(
      '*/10 * * * *',
      { timezone, protect: true, name: 'notify-offers' },
      track('notify-offers'),
    ),
    new Cron('20 */2 * * *', { timezone, protect: true, name: 'sync-fast' }, track('sync-fast')),
    new Cron('10 14,22 * * *', { timezone, protect: true, name: 'recheck' }, track('recheck')),
    // A no-op unless a field has no English or its Chinese changed since it was translated.
    new Cron('40 * * * *', { timezone, protect: true, name: 'translate' }, track('translate')),
    // After translate, so new English reaches search engines within the hour.
    new Cron('55 * * * *', { timezone, protect: true, name: 'indexnow' }, track('indexnow')),
  ];
  for (const cron of crons)
    log('schedule', `${cron.name} next at ${cron.nextRun()?.toISOString()}`);
  await new Promise<void>((resolve) =>
    rt.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  log('schedule', 'stopping: waiting for the running job to wind down');
  for (const cron of crons) cron.stop();
  await Promise.allSettled([...running]);
}

function parseArgs(argv: string[]) {
  const [name, ...rest] = argv;
  const options: JobOptions = { dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--sample') {
      const sample = Number(rest[++i]);
      if (!Number.isInteger(sample) || sample < 1)
        throw new Error('--sample needs a positive integer');
      options.sample = sample;
    } else if (arg === '--limit') {
      const limit = Number(rest[++i]);
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error('--limit needs a positive integer');
      options.limit = limit;
    } else throw new Error(`unknown argument "${arg}"\n${USAGE}`);
  }
  return { name, options };
}

const controller = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log('main', `${signal} received, finishing the current item`);
    controller.abort();
  });
}

let exitCode = 0;
try {
  const { name, options } = parseArgs(process.argv.slice(2));
  if (!name) throw new Error(USAGE);
  // The evaluation only reports; it never records a run or writes fields.
  if (name === 'translate-eval' || name === 'audit-eval') options.dryRun = true;
  const rt = createRuntime(controller.signal);
  try {
    if (name === 'schedule') await schedule(rt);
    else if (!(await runNamed(rt, name, options))) exitCode = 1;
  } finally {
    await rt.db.$client.end({ timeout: 5 });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
}
process.exitCode = exitCode;
