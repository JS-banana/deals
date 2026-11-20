import type { ProposalStatus } from '@deals/db';
import {
  and,
  asc,
  count,
  deals,
  desc,
  eq,
  events,
  getDb,
  ne,
  pipelineRuns,
  products,
  proposals,
} from '@deals/db';

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

export async function pendingCount() {
  const [row] = await getDb()
    .select({ n: count() })
    .from(proposals)
    .where(eq(proposals.status, 'pending'));
  return row?.n ?? 0;
}

export async function proposalCounts() {
  const rows = await getDb()
    .select({ status: proposals.status, n: count() })
    .from(proposals)
    .groupBy(proposals.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<ProposalStatus, number>
  >;
}

const newestFirst = [desc(proposals.createdAt), desc(proposals.id)] as const;

/** Queue rows; product/event names come from the payload, else from the affected deal. */
export async function listProposals(status: ProposalStatus) {
  const db = getDb();
  const [rows, dealRows, productRows, eventRows] = await Promise.all([
    db
      .select()
      .from(proposals)
      .where(eq(proposals.status, status))
      .orderBy(...newestFirst)
      .limit(200),
    db.select().from(deals),
    db.select().from(products),
    db.select().from(events),
  ]);
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const eventById = new Map(eventRows.map((e) => [e.id, e]));
  const eventBySlug = new Map(eventRows.map((e) => [e.slug, e]));
  return rows.map((p) => {
    const deal = p.dealId ? dealById.get(p.dealId) : undefined;
    const event =
      (p.payload && eventBySlug.get(p.payload.event)) || eventById.get(deal?.eventId ?? 0);
    return {
      id: p.id,
      kind: p.kind,
      reason: p.reason,
      confidence: p.confidence,
      createdAt: p.createdAt,
      changeCount: p.changes.length,
      evidenceCount: p.evidence.length,
      productName: p.payload?.product.name ?? productById.get(deal?.productId ?? 0)?.name ?? null,
      eventName: event?.name.zh ?? p.payload?.event ?? null,
    };
  });
}

export async function nextPendingId(exceptId: number) {
  const [row] = await getDb()
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.status, 'pending'), ne(proposals.id, exceptId)))
    .orderBy(...newestFirst)
    .limit(1);
  return row?.id ?? null;
}

export async function getProposal(id: number) {
  const [row] = await getDb().select().from(proposals).where(eq(proposals.id, id));
  return row;
}

/** Current state of a deal with its product and event, for flag review. */
export async function getDealWithRefs(id: number) {
  const [row] = await getDb()
    .select({ deal: deals, product: products, event: events })
    .from(deals)
    .innerJoin(products, eq(deals.productId, products.id))
    .innerJoin(events, eq(deals.eventId, events.id))
    .where(eq(deals.id, id));
  return row ?? null;
}

/** All deals (any status) with product and event, in editorial order. */
export async function listAdminDeals() {
  return getDb()
    .select({ deal: deals, product: products, event: events })
    .from(deals)
    .innerJoin(products, eq(deals.productId, products.id))
    .innerJoin(events, eq(deals.eventId, events.id))
    .orderBy(asc(deals.rank), asc(deals.id));
}

export async function listAdminEvents() {
  return getDb().select().from(events).orderBy(asc(events.id));
}

export async function getEventRow(id: number) {
  const [row] = await getDb().select().from(events).where(eq(events.id, id));
  return row;
}

export async function listRuns() {
  return getDb().select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(50);
}
