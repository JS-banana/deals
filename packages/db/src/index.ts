import {
  type Deal,
  type DealEvent,
  type DealView,
  dealSchema,
  type Product,
  type PublishStatus,
  productSchema,
} from '@deals/core';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { deals, events, priceObservations, products, proposals } from './schema.ts';

export * from './schema.ts';
// Query operators re-exported so apps share this package's drizzle-orm instance.
export { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { max: 10 }), { schema });
}
export type Db = ReturnType<typeof createDb>;

/** One pool per process; kept on globalThis so Next.js dev reloads do not leak connections. */
export function getDb(): Db {
  const store = globalThis as { __dealsDb?: Db };
  store.__dealsDb ??= createDb();
  return store.__dealsDb;
}

type DealRow = typeof deals.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type EventRow = typeof events.$inferSelect;

export function toDeal(row: DealRow): Deal {
  const { id, productId, eventId, status, rank, createdAt, updatedAt, startsAt, endsAt, ...rest } =
    row;
  return {
    ...rest,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
  };
}

/** Deal fields as column values (instants become Date objects). */
export function dealColumns(deal: Deal) {
  return {
    ...deal,
    startsAt: deal.startsAt ? new Date(deal.startsAt) : null,
    endsAt: deal.endsAt ? new Date(deal.endsAt) : null,
  };
}

export function toProduct(row: ProductRow): Product & { id: number } {
  const { createdAt, updatedAt, ...product } = row;
  return product;
}

export function toEvent(row: EventRow): DealEvent & { id: number } {
  const { createdAt, updatedAt, ...event } = row;
  return event;
}

export interface DealQuery {
  statuses?: PublishStatus[];
  eventSlug?: string;
  productSlug?: string;
}

/** Deals joined with product and event, in editorial order. */
export async function listDeals(db: Db, query: DealQuery = {}): Promise<DealView[]> {
  const where: SQL[] = [inArray(deals.status, query.statuses ?? ['published'])];
  if (query.eventSlug) where.push(eq(events.slug, query.eventSlug));
  if (query.productSlug) where.push(eq(products.slug, query.productSlug));
  const rows = await db
    .select({
      deal: deals,
      product: products,
      event: { id: events.id, slug: events.slug, kind: events.kind, name: events.name },
    })
    .from(deals)
    .innerJoin(products, eq(deals.productId, products.id))
    .innerJoin(events, eq(deals.eventId, events.id))
    .where(and(...where))
    .orderBy(asc(deals.rank), asc(deals.id));
  return rows.map(({ deal, product, event }) => ({
    ...toDeal(deal),
    id: deal.id,
    rank: deal.rank,
    status: deal.status,
    product: toProduct(product),
    event,
  }));
}

export async function getProduct(db: Db, slug: string) {
  const [row] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  return row ? toProduct(row) : null;
}

export async function listEvents(db: Db) {
  const rows = await db.select().from(events).orderBy(desc(events.startsOn));
  return rows.map(toEvent);
}

export async function getPriceHistory(db: Db, dealIds: number[]) {
  if (!dealIds.length) return [];
  return db
    .select()
    .from(priceObservations)
    .where(inArray(priceObservations.dealId, dealIds))
    .orderBy(asc(priceObservations.observedAt));
}

export type NewProposal = Omit<
  typeof proposals.$inferInsert,
  'id' | 'status' | 'createdAt' | 'reviewedAt' | 'reviewNote'
>;

/** File a proposal unless one with the same dedupe key already exists. Returns the new id. */
export async function fileProposal(db: Db, proposal: NewProposal): Promise<number | null> {
  const [row] = await db
    .insert(proposals)
    .values(proposal)
    .onConflictDoNothing({ target: proposals.dedupeKey })
    .returning({ id: proposals.id });
  return row?.id ?? null;
}

/**
 * Approve a pending proposal, optionally with an edited payload, and publish it:
 * upsert the product by slug and the deal by (product, event). Validation runs on the final payload.
 */
export async function approveProposal(
  db: Db,
  id: number,
  edited?: schema.ProposalPayload,
  note?: string,
) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, id)).for('update');
    if (!proposal) throw new Error(`proposal ${id} not found`);
    if (proposal.status !== 'pending') throw new Error(`proposal ${id} is ${proposal.status}`);
    const payload = edited ?? proposal.payload;
    let dealId = proposal.dealId;
    if (payload) {
      const product = productSchema.parse(payload.product);
      const deal = dealSchema.parse(payload.deal);
      const [event] = await tx.select().from(events).where(eq(events.slug, payload.event));
      if (!event) throw new Error(`unknown event ${payload.event}`);
      const { logoPath, ...productFields } = product;
      const [productRow] = await tx
        .insert(products)
        .values(product)
        .onConflictDoUpdate({
          target: products.slug,
          // Keep an existing logo when the proposal does not carry one.
          set: logoPath ? product : productFields,
        })
        .returning({ id: products.id });
      if (!productRow) throw new Error('product upsert failed');
      const columns = dealColumns(deal);
      const [dealRow] = await tx
        .insert(deals)
        .values({ ...columns, productId: productRow.id, eventId: event.id, status: 'published' })
        .onConflictDoUpdate({ target: [deals.productId, deals.eventId], set: columns })
        .returning({ id: deals.id });
      dealId = dealRow?.id ?? dealId;
    }
    await tx
      .update(proposals)
      .set({
        status: 'approved',
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        dealId,
        payload: payload ?? proposal.payload,
      })
      .where(eq(proposals.id, id));
    return { dealId };
  });
}

export async function rejectProposal(db: Db, id: number, note?: string) {
  await db
    .update(proposals)
    .set({ status: 'rejected', reviewedAt: new Date(), reviewNote: note ?? null })
    .where(and(eq(proposals.id, id), eq(proposals.status, 'pending')));
}
