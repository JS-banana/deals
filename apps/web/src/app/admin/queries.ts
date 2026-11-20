import type { ProposalStatus } from '@deals/db';
import { deals, events, getDb, products } from '@deals/db';

// The web app has no direct drizzle-orm dependency (no `eq`/`and`), so filtered reads use the
// pool's tagged-template SQL (`db.$client`) or the relational API, whose callbacks receive operators.

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

export async function pendingCount() {
  const [row] = await getDb().$client<
    { n: number }[]
  >`select count(*)::int as n from proposals where status = 'pending'`;
  return row?.n ?? 0;
}

export async function proposalCounts() {
  const rows = await getDb().$client<
    { status: ProposalStatus; n: number }[]
  >`select status, count(*)::int as n from proposals group by status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<ProposalStatus, number>
  >;
}

export interface QueueRow {
  id: number;
  kind: 'create' | 'update' | 'flag';
  reason: string;
  confidence: number | null;
  createdAt: string;
  changeCount: number;
  evidenceCount: number;
  productName: string | null;
  eventName: string | null;
}

export async function listProposals(status: ProposalStatus) {
  return getDb().$client<QueueRow[]>`
    select p.id, p.kind, p.reason, p.confidence, p.created_at as "createdAt",
      jsonb_array_length(p.changes) as "changeCount",
      jsonb_array_length(p.evidence) as "evidenceCount",
      coalesce(p.payload->'product'->>'name', pr.name) as "productName",
      coalesce(e.name->>'zh', p.payload->>'event') as "eventName"
    from proposals p
    left join deals d on d.id = p.deal_id
    left join products pr on pr.id = d.product_id
    left join events e on e.id = coalesce((select id from events where slug = p.payload->>'event'), d.event_id)
    where p.status = ${status}
    order by p.created_at desc, p.id desc
    limit 200`;
}

export async function nextPendingId(exceptId: number) {
  const [row] = await getDb().$client<{ id: number }[]>`
    select id from proposals where status = 'pending' and id <> ${exceptId}
    order by created_at desc, id desc limit 1`;
  return row?.id ?? null;
}

export async function getProposal(id: number) {
  return getDb().query.proposals.findFirst({ where: (t, { eq }) => eq(t.id, id) });
}

/** Current state of a deal with its product and event, for flag review. */
export async function getDealWithRefs(id: number) {
  const db = getDb();
  const deal = await db.query.deals.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  if (!deal) return null;
  const [product, event] = await Promise.all([
    db.query.products.findFirst({ where: (t, { eq }) => eq(t.id, deal.productId) }),
    db.query.events.findFirst({ where: (t, { eq }) => eq(t.id, deal.eventId) }),
  ]);
  return product && event ? { deal, product, event } : null;
}

/** All deals (any status) with product and event. Tables are small, so join in memory. */
export async function listAdminDeals() {
  const db = getDb();
  const [dealRows, productRows, eventRows] = await Promise.all([
    db.select().from(deals),
    db.select().from(products),
    db.select().from(events),
  ]);
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const eventById = new Map(eventRows.map((e) => [e.id, e]));
  return dealRows
    .flatMap((deal) => {
      const product = productById.get(deal.productId);
      const event = eventById.get(deal.eventId);
      return product && event ? [{ deal, product, event }] : [];
    })
    .sort((a, b) => a.deal.rank - b.deal.rank || a.deal.id - b.deal.id);
}

export async function listAdminEvents() {
  return (await getDb().select().from(events)).sort((a, b) => a.id - b.id);
}

export async function getEventRow(id: number) {
  return getDb().query.events.findFirst({ where: (t, { eq }) => eq(t.id, id) });
}

export async function listRuns() {
  return getDb().query.pipelineRuns.findMany({
    orderBy: (t, { desc }) => desc(t.startedAt),
    limit: 50,
  });
}
