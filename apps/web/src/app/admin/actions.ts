'use server';

import { dealSchema, eventSchema, PUBLISH_STATUS, productSchema } from '@deals/core';
import {
  approveProposal,
  dealColumns,
  deals,
  events,
  getDb,
  products,
  rejectProposal,
} from '@deals/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getEventRow, getProposal, nextPendingId } from './queries';

export interface FormState {
  error?: string;
  issues?: string[];
  message?: string;
}

const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().max(2000);
const payloadSchema = z.object({
  product: productSchema,
  event: z.string().trim().min(1),
  deal: dealSchema,
});

const text = (fd: FormData, name: string) => {
  const value = fd.get(name);
  return typeof value === 'string' ? value : '';
};

function parseWith<T extends z.ZodType>(
  schema: T,
  raw: string,
  prepare?: (value: unknown) => unknown,
): { data: z.infer<T> } | { state: FormState } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { state: { error: `JSON 语法错误：${e instanceof Error ? e.message : String(e)}` } };
  }
  const result = schema.safeParse(prepare ? prepare(json) : json);
  if (result.success) return { data: result.data };
  return {
    state: {
      error: '校验未通过，请修正后重试（已保留你的输入）。',
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(根)'}：${i.message}`),
    },
  };
}

function describe(e: unknown): string {
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === '23505') return '唯一约束冲突：slug 或「产品 + 活动」组合已存在。';
  return cause?.message ?? (e instanceof Error ? e.message : '未知错误');
}

const refresh = () => revalidatePath('/admin', 'layout');

/* ───────────── proposals ───────────── */

export async function approveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(text(fd, 'id'));
  const note = noteSchema.safeParse(text(fd, 'note'));
  if (!id.success || !note.success) return { error: '参数无效。' };
  const proposal = await getProposal(id.data);
  if (!proposal) return { error: '提案不存在。' };
  if (proposal.status !== 'pending') return { error: `该提案已处理（${proposal.status}）。` };
  if (proposal.kind === 'flag' || !proposal.payload)
    return { error: '异常提案没有可发布的内容，请使用「隐藏优惠」或「忽略」。' };

  const parsed = parseWith(payloadSchema, text(fd, 'payload'));
  if ('state' in parsed) return parsed.state;
  try {
    await approveProposal(getDb(), id.data, parsed.data, note.data || undefined);
  } catch (e) {
    return { error: describe(e) };
  }
  refresh();
  const next = await nextPendingId(id.data);
  redirect(next ? `/admin/proposals/${next}` : '/admin');
}

export async function rejectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(text(fd, 'id'));
  const note = noteSchema.safeParse(text(fd, 'note'));
  if (!id.success || !note.success) return { error: '参数无效。' };
  try {
    await rejectProposal(getDb(), id.data, note.data || undefined);
  } catch (e) {
    return { error: describe(e) };
  }
  refresh();
  const next = await nextPendingId(id.data);
  redirect(next ? `/admin/proposals/${next}` : '/admin');
}

/** Flag review: `hide` hides the affected deal and closes the proposal as approved; `dismiss` rejects it. */
export async function resolveFlagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(text(fd, 'id'));
  const decision = z.enum(['hide', 'dismiss']).safeParse(text(fd, 'decision'));
  const note = noteSchema.safeParse(text(fd, 'note'));
  if (!id.success || !decision.success || !note.success) return { error: '参数无效。' };
  const db = getDb();
  try {
    if (decision.data === 'dismiss') {
      await rejectProposal(db, id.data, note.data || undefined);
    } else {
      await db.$client.begin(async (tx) => {
        const [p] = await tx<{ status: string; kind: string; dealId: number | null }[]>`
          select status, kind, deal_id as "dealId" from proposals where id = ${id.data} for update`;
        if (p?.status !== 'pending' || p.kind !== 'flag' || p.dealId === null)
          throw new Error('提案不是待处理的异常提案，或没有关联优惠。');
        await tx`update deals set status = 'hidden', updated_at = now() where id = ${p.dealId}`;
        await tx`update proposals set status = 'approved', reviewed_at = now(),
          review_note = ${note.data || null} where id = ${id.data}`;
      });
    }
  } catch (e) {
    return { error: describe(e) };
  }
  refresh();
  const next = await nextPendingId(id.data);
  redirect(next ? `/admin/proposals/${next}` : '/admin');
}

/* ───────────── deals ───────────── */

export async function setDealStatusAction(fd: FormData) {
  const id = idSchema.parse(text(fd, 'id'));
  const status = z.enum(PUBLISH_STATUS).parse(text(fd, 'status'));
  await getDb().$client`update deals set status = ${status}, updated_at = now() where id = ${id}`;
  refresh();
}

export async function setDealRankAction(fd: FormData) {
  const id = idSchema.parse(text(fd, 'id'));
  const rank = z
    .string()
    .regex(/^\d{1,7}$/)
    .transform(Number)
    .parse(text(fd, 'rank'));
  await getDb().$client`update deals set rank = ${rank}, updated_at = now() where id = ${id}`;
  refresh();
}

/**
 * Save `{product, deal}` for an existing deal. Rows are written as upserts keyed by primary key
 * (no drizzle-orm operators available here); a slug owned by another product still fails on the
 * unique constraint. `logoPath` is kept when the edited product omits it.
 */
export async function saveDealAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = idSchema.safeParse(text(fd, 'id'));
  if (!id.success) return { error: '参数无效。' };
  const db = getDb();
  const row = await db.query.deals.findFirst({ where: (t, { eq }) => eq(t.id, id.data) });
  if (!row) return { error: '优惠不存在。' };
  const existing = await db.query.products.findFirst({
    where: (t, { eq }) => eq(t.id, row.productId),
  });
  if (!existing) return { error: '产品不存在。' };

  const parsed = parseWith(
    z.object({ product: productSchema, deal: dealSchema }),
    text(fd, 'payload'),
    (json) => {
      const product = (json as { product?: unknown } | null)?.product;
      if (product && typeof product === 'object' && !('logoPath' in product))
        return { ...(json as object), product: { ...product, logoPath: existing.logoPath } };
      return json;
    },
  );
  if ('state' in parsed) return parsed.state;
  const { product, deal } = parsed.data;
  const updatedAt = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(products)
        .values({ id: existing.id, ...product, updatedAt })
        .onConflictDoUpdate({ target: products.id, set: { ...product, updatedAt } });
      const columns = dealColumns(deal);
      await tx
        .insert(deals)
        .values({
          id: row.id,
          productId: row.productId,
          eventId: row.eventId,
          status: row.status,
          rank: row.rank,
          ...columns,
          updatedAt,
        })
        .onConflictDoUpdate({ target: deals.id, set: { ...columns, updatedAt } });
    });
  } catch (e) {
    return { error: describe(e) };
  }
  refresh();
  return { message: '已保存。' };
}

/* ───────────── events ───────────── */

/** Create (`id` = "new") or edit an event. Saving one as featured un-features all others. */
export async function saveEventAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const rawId = text(fd, 'id');
  const id = rawId === 'new' ? null : idSchema.safeParse(rawId);
  if (id && !id.success) return { error: '参数无效。' };
  const parsed = parseWith(eventSchema, text(fd, 'payload'));
  if ('state' in parsed) return parsed.state;
  const event = parsed.data;
  const db = getDb();
  if (id?.success && !(await getEventRow(id.data))) return { error: '活动不存在。' };
  try {
    await db.transaction(async (tx) => {
      if (event.featured) await tx.update(events).set({ featured: false });
      if (id?.success) {
        await tx
          .insert(events)
          .values({ id: id.data, ...event })
          .onConflictDoUpdate({ target: events.id, set: { ...event, updatedAt: new Date() } });
      } else {
        await tx.insert(events).values(event);
      }
    });
  } catch (e) {
    return { error: describe(e) };
  }
  refresh();
  redirect('/admin/events');
}

export async function featureEventAction(fd: FormData) {
  const id = idSchema.parse(text(fd, 'id'));
  const row = await getEventRow(id);
  if (!row) throw new Error('活动不存在');
  await getDb().transaction(async (tx) => {
    await tx.update(events).set({ featured: false });
    await tx
      .insert(events)
      .values(row)
      .onConflictDoUpdate({ target: events.id, set: { featured: true, updatedAt: new Date() } });
  });
  refresh();
}
