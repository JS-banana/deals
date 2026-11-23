import { type Db, pageSnapshots, sql } from '@deals/db';
import type { Job } from './runtime.ts';

export async function pruneSnapshots(
  db: Pick<Db, 'select' | 'update'>,
  keepDays = 30,
  dryRun = false,
) {
  if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('invalid retention period');
  const eligible = sql`text is not null and fetched_at < now() - make_interval(days => ${keepDays}::int)
    and not exists (select 1 from proposals p where p.snapshot_id = page_snapshots.id)
    and exists (select 1 from page_snapshots newer where newer.url = page_snapshots.url
      and (newer.fetched_at, newer.id) > (page_snapshots.fetched_at, page_snapshots.id))`;
  if (dryRun) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pageSnapshots)
      .where(eligible);
    return row?.count ?? 0;
  }
  return (await db.update(pageSnapshots).set({ text: null }).where(eligible)).count;
}

export const prune: Job = async (ctx) => {
  ctx.stats.prunedBodies = await pruneSnapshots(ctx.db, 30, ctx.dryRun);
};
