import { isDeepStrictEqual } from 'node:util';
import {
  type Deal,
  type DealEvent,
  type DealView,
  dealSchema,
  type Product,
  type PublishStatus,
  productSchema,
} from '@deals/core';
import { and, asc, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { deals, events, priceObservations, products, proposals } from './schema.ts';

// Query operators re-exported so apps share this package's drizzle-orm instance.
export { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
export * from './schema.ts';

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { max: 10 }), { schema });
}
export type Db = ReturnType<typeof createDb>;

/** Keep a session-level advisory lock on a dedicated connection for the duration of the work. */
export async function withAdvisoryLock(
  db: Pick<Db, '$client'>,
  key: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const reserved = await db.$client.reserve();
  let locked = false;
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked
    `;
    locked = row?.locked ?? false;
    if (!locked) return false;
    await fn();
    return true;
  } finally {
    if (locked)
      await reserved`select pg_advisory_unlock(hashtextextended(${key}, 0))`.catch(() => {});
    reserved.release();
  }
}

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
  const {
    id,
    productId,
    eventId,
    status,
    rank,
    createdAt,
    updatedAt,
    startsAt,
    endsAt,
    observedEndedAt,
    ...rest
  } = row;
  return {
    ...rest,
    observedEndedAt: observedEndedAt?.toISOString() ?? null,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
  };
}

/** Deal fields as column values (instants become Date objects). */
export function dealColumns(deal: Deal) {
  return {
    ...deal,
    observedEndedAt: deal.observedEndedAt ? new Date(deal.observedEndedAt) : null,
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
  | 'id'
  | 'status'
  | 'createdAt'
  | 'reviewedAt'
  | 'reviewNote'
  | 'reviewedBy'
  | 'reviewEdited'
  | 'approvedPayload'
>;

/** File a proposal unless one with the same dedupe key already exists. Returns the new id. */
export async function fileProposal(
  db: Pick<Db, 'insert'>,
  proposal: NewProposal,
): Promise<number | null> {
  const [row] = await db
    .insert(proposals)
    .values(proposal)
    .onConflictDoNothing({ target: proposals.dedupeKey })
    .returning({ id: proposals.id });
  return row?.id ?? null;
}

type Reviewer = NonNullable<typeof proposals.$inferSelect.reviewedBy>;
type ReviewTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ProposalRow = typeof proposals.$inferSelect;

function parsePayload(payload: schema.ProposalPayload): schema.ProposalPayload {
  return {
    product: productSchema.parse(payload.product),
    event: payload.event,
    deal: dealSchema.parse(payload.deal),
  };
}

function sameField(field: keyof Deal, left: unknown, right: unknown) {
  if (
    (field === 'startsAt' || field === 'endsAt' || field === 'observedEndedAt') &&
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    return Date.parse(left) === Date.parse(right);
  }
  return isDeepStrictEqual(left, right);
}

// These fields describe the source or presentation and do not attest to the commercial offer.
const nonOfferFields = new Set<keyof Deal>(['sourceUrl', 'cardNote', 'checkedOn']);

function reviewedPatch(
  changes: schema.FieldChange[],
  original: Deal,
  edited: Deal,
  current: Deal,
  actor: Reviewer,
) {
  const fields = new Set<keyof Deal>();
  const conflicts: string[] = [];
  for (const change of changes) {
    if (!Object.hasOwn(original, change.field)) throw new Error(`未知的变更字段 ${change.field}`);
    const field = change.field as keyof Deal;
    if (fields.has(field) || !sameField(field, original[field], change.after))
      throw new Error(`提案差异与原稿不一致：${field}`);
    fields.add(field);
    if (!sameField(field, current[field], change.before)) conflicts.push(field);
  }
  for (const field of Object.keys(original) as (keyof Deal)[]) {
    if (fields.has(field)) continue;
    if (!sameField(field, edited[field], original[field]))
      throw new Error(`字段 ${field} 不在本次提案差异中，请单独编辑优惠。`);
    // The auditor saw the entire offer. A later change to another material term invalidates its verdict.
    if (
      actor === 'ai' &&
      !nonOfferFields.has(field) &&
      !sameField(field, current[field], original[field])
    )
      conflicts.push(field);
  }
  if (conflicts.length) return { conflict: `优惠已被修改：${conflicts.join('、')}` } as const;

  const patch = Object.fromEntries([...fields].map((field) => [field, edited[field]]));
  if (actor === 'ai') {
    patch.verified = true;
    fields.add('verified');
  }
  const merged = dealSchema.safeParse({ ...current, ...patch });
  if (!merged.success) {
    const invalid = merged.error.issues.map((issue) => issue.path.join('.')).join('、');
    return { conflict: `当前优惠与变更不兼容：${invalid}` } as const;
  }
  const columns = dealColumns(merged.data);
  return {
    columns: Object.fromEntries([...fields].map((field) => [field, columns[field]])),
  } as const;
}

type Publication = { dealId: number; payload: schema.ProposalPayload } | { conflict: string };

async function publishUpdate(
  tx: ReviewTx,
  proposal: ProposalRow,
  original: schema.ProposalPayload,
  edited: schema.ProposalPayload,
  actor: Reviewer,
): Promise<Publication> {
  if (proposal.dealId === null) throw new Error('更新提案缺少关联优惠。');
  if (edited.event !== original.event || !isDeepStrictEqual(edited.product, original.product))
    throw new Error('更新提案只能修改差异中列出的优惠字段，请单独编辑产品或活动。');

  // Keep product and event metadata stable while recording the published copy. The admin editor
  // takes its product lock before updating a deal, so take the locks in the same order here.
  const [refs] = await tx
    .select({ product: products, eventId: events.id, event: events.slug })
    .from(deals)
    .innerJoin(products, eq(deals.productId, products.id))
    .innerJoin(events, eq(deals.eventId, events.id))
    .where(eq(deals.id, proposal.dealId))
    .for('share', { of: [products, events] });
  const [record] = await tx.select().from(deals).where(eq(deals.id, proposal.dealId)).for('update');
  if (!refs || !record) return { conflict: '关联优惠已不存在。' };
  if (
    refs.product.id !== record.productId ||
    refs.eventId !== record.eventId ||
    refs.product.slug !== original.product.slug ||
    refs.event !== original.event
  )
    return { conflict: '关联产品或活动已变更。' };
  if (actor === 'ai' && record.status !== 'published') return { conflict: '优惠已停止发布。' };
  const patch = reviewedPatch(proposal.changes, original.deal, edited.deal, toDeal(record), actor);
  if (patch.conflict !== undefined) return { conflict: patch.conflict };
  if (!Object.keys(patch.columns).length) throw new Error('更新提案没有变更字段。');
  const [updated] = await tx
    .update(deals)
    .set(patch.columns)
    .where(eq(deals.id, record.id))
    .returning();
  if (!updated) throw new Error('更新优惠失败。');
  return {
    dealId: updated.id,
    payload: {
      event: refs.event,
      product: productSchema.parse(refs.product),
      deal: toDeal(updated),
    },
  };
}

async function publishCreate(
  tx: ReviewTx,
  edited: schema.ProposalPayload,
  actor: Reviewer,
  aiVerified = true,
): Promise<Publication> {
  const { product, event, deal } = edited;
  const [eventRow] = await tx
    .select({ id: events.id })
    .from(events)
    .where(eq(events.slug, event))
    .for('share');
  if (!eventRow) throw new Error(`未知活动 ${event}`);
  const { logoPath, ...productFields } = product;
  const insertProduct = tx.insert(products).values(product);
  const [written] = await (actor === 'human'
    ? insertProduct.onConflictDoUpdate({
        target: products.slug,
        set: logoPath ? product : productFields,
      })
    : insertProduct.onConflictDoNothing({ target: products.slug })
  ).returning();
  const productRow =
    written ??
    (await tx.select().from(products).where(eq(products.slug, product.slug)).for('update'))[0];
  if (!productRow) throw new Error('未找到产品。');
  if (
    actor === 'ai' &&
    (productRow.name !== product.name || productRow.website !== product.website)
  )
    return { conflict: '同一 slug 的产品名称或官网已变更。' };
  const [featured] =
    actor === 'ai'
      ? await tx
          .select({ rank: deals.rank })
          .from(deals)
          .where(
            and(
              eq(deals.productId, productRow.id),
              eq(deals.eventId, eventRow.id),
              eq(deals.status, 'published'),
              lt(deals.rank, 1000),
            ),
          )
          .orderBy(asc(deals.rank))
          .limit(1)
      : [];
  const columns = dealColumns(deal);
  const insertDeal = tx.insert(deals).values({
    ...columns,
    verified: actor === 'ai' ? aiVerified || deal.verified : deal.verified,
    productId: productRow.id,
    eventId: eventRow.id,
    status: 'published',
    rank: featured?.rank,
  });
  const target = [deals.productId, deals.eventId, deals.offerKey];
  const [published] = await (actor === 'human'
    ? insertDeal.onConflictDoUpdate({ target, set: columns })
    : insertDeal.onConflictDoNothing({ target })
  ).returning();
  if (!published) return { conflict: '该产品在此活动中已有优惠。' };
  return {
    dealId: published.id,
    payload: { event, product: productSchema.parse(productRow), deal: toDeal(published) },
  };
}

/** Publish a reviewed candidate and keep the original payload for later replay. */
export async function approveProposal(
  db: Pick<Db, 'transaction'>,
  id: number,
  edited?: schema.ProposalPayload,
  note?: string,
  actor: Reviewer = 'human',
): Promise<{ dealId: number | null; conflict: string | null }> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, id)).for('update');
    if (!proposal) throw new Error(`proposal ${id} not found`);
    if (proposal.status !== 'pending')
      return { dealId: proposal.dealId, conflict: `该提案已处理（${proposal.status}）。` };
    if (proposal.kind === 'flag' || !proposal.payload) throw new Error('此提案没有可发布的内容。');
    if (actor === 'ai' && (edited || proposal.shadowDecision?.action !== 'auto_approve'))
      throw new Error('只有通过自动发布门禁的原稿可以自动审批。');
    const original = parsePayload(proposal.payload);
    const candidate = edited ? parsePayload(edited) : original;
    const result =
      proposal.kind === 'update'
        ? await publishUpdate(tx, proposal, original, candidate, actor)
        : await publishCreate(tx, candidate, actor, proposal.shadowDecision?.verified ?? true);
    if ('conflict' in result) {
      await tx.update(proposals).set({ reviewNote: result.conflict }).where(eq(proposals.id, id));
      return { dealId: proposal.dealId, conflict: result.conflict };
    }
    await tx
      .update(proposals)
      .set({
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: actor,
        reviewNote: note ?? null,
        reviewEdited: actor === 'human' && !isDeepStrictEqual(candidate, original),
        dealId: result.dealId,
        approvedPayload: result.payload,
      })
      .where(eq(proposals.id, id));
    return { dealId: result.dealId, conflict: null };
  });
}

export async function rejectProposal(
  db: Pick<Db, 'update'>,
  id: number,
  note?: string,
  actor: Reviewer = 'human',
): Promise<boolean> {
  const rows = await db
    .update(proposals)
    .set({
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: actor,
      reviewNote: note ?? null,
      reviewEdited: false,
    })
    .where(
      and(
        eq(proposals.id, id),
        eq(proposals.status, 'pending'),
        actor === 'ai' ? sql`${proposals.shadowDecision}->>'action' = 'auto_reject'` : undefined,
      ),
    )
    .returning({ id: proposals.id });
  return rows.length === 1;
}
