import { count, deals, eq, getDb } from '@deals/db';

export const dynamic = 'force-dynamic';

/** Liveness and database round-trip for the Docker healthcheck. */
export async function GET() {
  try {
    const [row] = await getDb()
      .select({ published: count() })
      .from(deals)
      .where(eq(deals.status, 'published'));
    return Response.json(
      { ok: true, deals: row?.published ?? 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
