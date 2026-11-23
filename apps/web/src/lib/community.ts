import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { and, count, type Db, deals, dealVotes, eq, getDb, gte, rawSignals, sql } from '@deals/db';
import { z } from 'zod';

// The ingress must overwrite X-Real-IP and be the only public route to Next.
export function communityIdentity(headers: Headers) {
  const secret = process.env.COMMUNITY_HASH_SECRET;
  const ip = headers.get('x-real-ip') ?? '';
  if (!secret || !isIP(ip)) return null;
  return createHmac('sha256', secret)
    .update(JSON.stringify([ip, headers.get('user-agent') ?? '']))
    .digest('hex');
}

const dealId = z.number().int().positive().max(2147483647);
export const voteInput = z.object({ dealId, valid: z.boolean() });
export const tipInput = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .pipe(z.url({ protocol: /^https?$/ }))
    .refine((s) => {
      const url = URL.parse(s);
      return url !== null && !url.username && !url.password;
    }),
  note: z.string().trim().min(1).max(500),
});

/** Only accept small JSON bodies, including chunked requests without a Content-Length. */
export async function readCommunityInput(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function voteSummary(id: number, db: Pick<Db, 'select'> = getDb()) {
  const [row] = await db
    .select({
      total: count(),
      valid: sql<number>`count(*) filter (where ${dealVotes.valid})`.mapWith(Number),
    })
    .from(dealVotes)
    .where(
      and(eq(dealVotes.dealId, id), gte(dealVotes.createdAt, sql`now() - interval '30 days'`)),
    );
  return row ?? { total: 0, valid: 0 };
}

export async function castVote(db: Db, who: string, vote: z.infer<typeof voteInput>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`vote:${vote.dealId}:${who}`},0))`,
    );
    const [deal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, vote.dealId), eq(deals.status, 'published')))
      .for('share');
    if (!deal) return { status: 404 };
    const [previous] = await tx
      .select({ id: dealVotes.id })
      .from(dealVotes)
      .where(
        and(
          eq(dealVotes.dealId, vote.dealId),
          eq(dealVotes.voterHash, who),
          gte(dealVotes.createdAt, sql`now() - interval '24 hours'`),
        ),
      )
      .limit(1);
    if (!previous) await tx.insert(dealVotes).values({ ...vote, voterHash: who });
    return { status: previous ? 429 : 201, summary: await voteSummary(vote.dealId, tx) };
  });
}

export async function submitTip(db: Db, who: string, tip: z.infer<typeof tipInput>) {
  const url = new URL(tip.url);
  url.hash = '';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const signalKey = `tip:${hash(url.href)}`;
  const fingerprint = hash(JSON.stringify([url.href, tip.note]));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tip:${who}`},0))`);
    const [existing] = await tx
      .select({ id: rawSignals.id })
      .from(rawSignals)
      .where(
        and(
          eq(rawSignals.sourceId, 'user-tips'),
          eq(rawSignals.signalKey, signalKey),
          eq(rawSignals.fingerprint, fingerprint),
        ),
      )
      .limit(1);
    if (existing) return 200;
    const [recent] = await tx
      .select({ total: count() })
      .from(rawSignals)
      .where(
        and(
          eq(rawSignals.submitterHash, who),
          gte(rawSignals.createdAt, sql`now() - interval '1 hour'`),
        ),
      );
    if ((recent?.total ?? 0) >= 5) return 429;
    const added = await tx
      .insert(rawSignals)
      .values({
        sourceId: 'user-tips',
        signalKey,
        fingerprint,
        submitterHash: who,
        signal: {
          signalKey,
          sourceType: 'user_tip',
          sourceName: 'Community tips',
          sourceUrl: url.href,
          title: tip.note,
          rawText: tip.note,
          candidateUrls: [url.href],
          publishedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: rawSignals.id });
    return added.length ? 201 : 200;
  });
}
