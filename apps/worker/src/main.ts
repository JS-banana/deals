import { Cron } from 'croner';
import { syncUpstream } from './extract.ts';
import { logos } from './logos.ts';
import { recheck } from './recheck.ts';
import { createRuntime, type Job, type JobOptions, log, type Runtime, runJob } from './runtime.ts';
import { translate } from './translate.ts';

const JOBS: Record<string, Job> = {
  translate,
  logos,
  'sync-upstream': syncUpstream,
  recheck,
};

const USAGE = `usage: node src/main.ts <translate|logos|sync-upstream|recheck|daily|schedule> [--limit N] [--dry-run]`;

/** translate -> logos -> sync-upstream (+extract) -> recheck; one failing job never stops the rest. */
async function daily(rt: Runtime, options: JobOptions) {
  const results = await runJob(rt, 'daily', options, async (ctx) => {
    for (const name of ['translate', 'logos', 'sync-upstream', 'recheck']) {
      if (rt.signal.aborted) break;
      const job = JOBS[name];
      if (!job) continue;
      const { ok } = await runJob(rt, name, options, job).catch(() => ({ ok: false }));
      ctx.stats[name] = ok ? 1 : 0;
      if (!ok) ctx.stats.failedJobs = (ctx.stats.failedJobs ?? 0) + 1;
    }
  });
  return results.ok && !results.stats.failedJobs;
}

async function runNamed(rt: Runtime, name: string, options: JobOptions): Promise<boolean> {
  if (name === 'daily') return daily(rt, options);
  const job = JOBS[name];
  if (!job) throw new Error(`unknown job "${name}"\n${USAGE}`);
  return (await runJob(rt, name, options, job)).ok;
}

async function schedule(rt: Runtime) {
  const timezone = 'Asia/Shanghai';
  const running = new Set<Promise<unknown>>();
  const track = (name: string) => () => {
    if (rt.signal.aborted) return;
    const run = runNamed(rt, name, { dryRun: false }).catch((e) =>
      log('schedule', `${name} crashed: ${e}`),
    );
    running.add(run);
    void run.finally(() => running.delete(run));
  };
  const crons = [
    new Cron('10 6 * * *', { timezone, protect: true, name: 'daily' }, track('daily')),
    new Cron('10 14,22 * * *', { timezone, protect: true, name: 'recheck' }, track('recheck')),
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
    else if (arg === '--limit') {
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
