import { randomUUID } from 'node:crypto';
import { dealSchema, type Product } from '@deals/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveProposal,
  createDb,
  type Db,
  deals,
  eq,
  events,
  fileProposal,
  inArray,
  type NewProposal,
  type ProposalPayload,
  products,
  proposals,
  rejectProposal,
  type ShadowDecision,
  withAdvisoryLock,
} from './index.ts';

// A dedicated PostgreSQL database with the project's migrations applied is required to exercise row locks.
const databaseUrl = process.env.REVIEW_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('proposal review transactions', () => {
  const prefix = `review-test-${randomUUID()}`;
  const otherEvent = `${prefix}-other`;
  const productSlugs: string[] = [];
  const proposalIds: number[] = [];
  let db: Db;
  const proposedDeal = dealSchema.parse({
    plan: { zh: '专业版', en: 'Pro' },
    billing: 'year',
    priceAmount: 40,
    originalAmount: 100,
    currency: 'USD',
    discountPercent: null,
    discountAmount: null,
    code: null,
    noCode: false,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    dateZone: null,
    observedLiveOn: null,
    oneTime: false,
    existingUsers: false,
    terms: { zh: '条款', en: 'Terms' },
    renewal: null,
    eligibility: null,
    cardNote: null,
    merchantUrl: 'https://example.com/offer',
    sourceUrl: null,
    verified: false,
    checkedOn: '2026-11-22',
  });
  function candidate(): ProposalPayload {
    const slug = `${prefix}-${productSlugs.length}`;
    productSlugs.push(slug);
    const product: Product = {
      slug,
      name: slug,
      website: 'https://example.com',
      category: 'utilities',
      logoPath: null,
      summary: { zh: '软件', en: 'Software' },
    };
    return { product, event: prefix, deal: structuredClone(proposedDeal) };
  }
  async function file(payload: ProposalPayload, input: Partial<NewProposal> = {}) {
    const id = await fileProposal(db, {
      kind: 'create',
      reason: 'review fixture',
      payload,
      dedupeKey: `${prefix}-${randomUUID()}`,
      ...input,
    });
    if (!id) throw new Error('expected a new fixture proposal');
    proposalIds.push(id);
    return id;
  }
  async function proposal(id: number) {
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
    if (!row) throw new Error('proposal missing');
    return row;
  }
  async function createDeal(payload = candidate()) {
    const { dealId, conflict } = await approveProposal(db, await file(payload));
    if (!dealId || conflict) throw new Error('expected a newly published fixture');
    return { dealId, payload };
  }
  const decision = (action: ShadowDecision['action']): ShadowDecision => ({
    action,
    score: 95,
    summary: 'fixture',
    issues: [],
  });
  async function priceUpdate(dealId: number, original: ProposalPayload, priceAmount: number) {
    const payload = { ...original, deal: { ...original.deal, priceAmount } };
    const id = await file(payload, {
      kind: 'update',
      dealId,
      changes: [{ field: 'priceAmount', before: original.deal.priceAmount, after: priceAmount }],
      shadowDecision: decision('auto_approve'),
    });
    return { id, payload };
  }
  beforeAll(async () => {
    db = createDb(databaseUrl);
    const name = { zh: '测试', en: 'Test' };
    await db
      .insert(events)
      .values([prefix, otherEvent].map((slug) => ({ slug, name, tagline: name })));
  });
  afterAll(async () => {
    try {
      if (proposalIds.length) await db.delete(proposals).where(inArray(proposals.id, proposalIds));
      if (productSlugs.length)
        await db.delete(products).where(inArray(products.slug, productSlugs));
      await db.delete(events).where(inArray(events.slug, [prefix, otherEvent]));
    } finally {
      await db.$client.end();
    }
  });

  it('declines a competing advisory lock while its holder is running', async () => {
    const key = `${prefix}:contention`;
    const acquired = await withAdvisoryLock(db, key, async () => {
      const competing = await withAdvisoryLock(db, key, async () => {
        throw new Error('the competing callback must not run');
      });
      expect(competing).toBe(false);
    });
    expect(acquired).toBe(true);
  });

  it('holds an advisory lock with no active transaction during the callback', async () => {
    const key = `${prefix}:transaction`;
    const acquired = await withAdvisoryLock(db, key, async () => {
      // Inspect the lock's own backend as well as the callback's query connection.
      const [activity] = await db.$client<{ txid: string | null; state: string }[]>`
        select txid_current_if_assigned() as txid, activity.state
        from pg_locks as held
        join pg_stat_activity as activity on activity.pid = held.pid
        where held.locktype = 'advisory' and held.granted and held.objsubid = 1
          and ((held.classid::bigint << 32) | held.objid::bigint) = hashtextextended(${key}, 0)
      `;
      expect(activity).toEqual({ txid: null, state: 'idle' });
    });
    expect(acquired).toBe(true);
  });

  it('releases an advisory lock after its callback throws', async () => {
    const key = `${prefix}:failure`;
    const failure = new Error('callback failed');
    await expect(
      withAdvisoryLock(db, key, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    // A different pool cannot reacquire a leaked session lock.
    const contender = createDb(databaseUrl);
    try {
      await expect(withAdvisoryLock(contender, key, async () => {})).resolves.toBe(true);
    } finally {
      await contender.$client.end();
    }
  });

  it('keeps the original, verifies only the approved copy, and preserves an existing product', async () => {
    const payload = candidate();
    const summary = { zh: '人工简介', en: 'Manual description' };
    await db.insert(products).values({ ...payload.product, summary });
    const id = await file(payload, { shadowDecision: decision('auto_approve') });
    expect((await approveProposal(db, id, undefined, 'accepted', 'ai')).conflict).toBeNull();
    const row = await proposal(id);
    expect(row).toMatchObject({
      reviewedBy: 'ai',
      reviewEdited: false,
      payload: { deal: { verified: false } },
      approvedPayload: { product: { summary }, deal: { verified: true } },
    });
    const duplicate = await file(
      { ...payload, deal: { ...payload.deal, priceAmount: 20 } },
      { shadowDecision: decision('auto_approve') },
    );
    expect(
      (await approveProposal(db, duplicate, undefined, undefined, 'ai')).conflict,
    ).toBeTruthy();
    expect(await proposal(duplicate)).toMatchObject({
      status: 'pending',
      reviewedBy: null,
      approvedPayload: null,
    });
    if (!row.dealId) throw new Error('expected a published deal');
    const [published] = await db.select().from(deals).where(eq(deals.id, row.dealId));
    expect(published?.priceAmount).toBe(40);
  });

  it.each([
    { shadow: { verified: false }, original: false, published: false },
    { shadow: { verified: true }, original: false, published: true },
    { shadow: {}, original: false, published: true },
    { shadow: { verified: false }, original: true, published: true },
  ])(
    'publishes AI verification $published from shadow $shadow and original $original',
    async ({ shadow, original, published }) => {
      const payload = candidate();
      payload.deal.verified = original;
      const id = await file(payload, {
        shadowDecision: { ...decision('auto_approve'), ...shadow },
      });
      const { dealId, conflict } = await approveProposal(db, id, undefined, undefined, 'ai');
      expect(conflict).toBeNull();
      if (dealId === null) throw new Error('expected a published deal');
      const [row] = await db.select().from(deals).where(eq(deals.id, dealId));
      expect(row?.verified).toBe(published);
      expect(await proposal(id)).toMatchObject({
        payload: { deal: { verified: original } },
        approvedPayload: { deal: { verified: published } },
      });
    },
  );

  it('inherits the lowest published rank only for AI offers of the same product and event', async () => {
    const payload = candidate();
    for (const [offerKey, rank, status] of [
      ['featured', 25, 'published'],
      ['pinned', 0, 'published'],
      ['hidden', -1, 'hidden'],
    ] as const) {
      const { dealId } = await createDeal({ ...payload, deal: { ...payload.deal, offerKey } });
      await db.update(deals).set({ rank, status }).where(eq(deals.id, dealId));
    }

    for (const [offer, actor, rank] of [
      [{ ...payload, deal: { ...payload.deal, offerKey: 'renewal' } }, 'ai', 0],
      [candidate(), 'ai', 1000],
      [{ ...payload, event: otherEvent }, 'ai', 1000],
      [{ ...payload, deal: { ...payload.deal, offerKey: 'human' } }, 'human', 1000],
    ] as const) {
      const id = await file(offer, { shadowDecision: decision('auto_approve') });
      const { dealId, conflict } = await approveProposal(db, id, undefined, undefined, actor);
      expect(conflict).toBeNull();
      if (dealId === null) throw new Error('expected a published deal');
      const [row] = await db.select().from(deals).where(eq(deals.id, dealId));
      expect(row?.rank).toBe(rank);
    }
  });

  it('preserves the existing human create upsert while keeping a previously assigned logo', async () => {
    const { dealId, payload } = await createDeal();
    await db
      .update(products)
      .set({ logoPath: '/fixture.svg' })
      .where(eq(products.slug, payload.product.slug));
    const changed = {
      ...payload,
      product: { ...payload.product, name: 'Reviewed' },
      deal: { ...payload.deal, priceAmount: 24 },
    };
    const id = await file(changed);
    expect(await approveProposal(db, id)).toEqual({ dealId, conflict: null });
    expect(await proposal(id)).toMatchObject({
      reviewedBy: 'human',
      reviewEdited: false,
      approvedPayload: {
        product: { name: 'Reviewed', logoPath: '/fixture.svg' },
        deal: { priceAmount: 24 },
      },
    });
  });

  it('keeps an unrelated edit and distinguishes a corrected price from a concurrent change', async () => {
    const { payload, dealId } = await createDeal();
    const first = await priceUpdate(dealId, payload, 32);
    const renewal = { zh: '按原价续订', en: 'Renews at full price' };
    await db.update(deals).set({ renewal }).where(eq(deals.id, dealId));
    expect((await approveProposal(db, first.id, first.payload)).conflict).toBeNull();
    const row = await proposal(first.id);
    expect(row).toMatchObject({
      reviewedBy: 'human',
      reviewEdited: false,
      payload: { deal: { renewal: null } },
      approvedPayload: { deal: { renewal, priceAmount: 32 } },
    });
    if (!row.approvedPayload) throw new Error('expected a published payload');
    const second = await priceUpdate(dealId, row.approvedPayload, 26);
    const edited = { ...second.payload, deal: { ...second.payload.deal, priceAmount: 25 } };
    expect((await approveProposal(db, second.id, edited)).conflict).toBeNull();
    expect(await proposal(second.id)).toMatchObject({
      reviewEdited: true,
      payload: { deal: { priceAmount: 26 } },
      approvedPayload: { deal: { priceAmount: 25 } },
    });
  });

  it('locks competing proposals and leaves the loser pending with the conflicting field', async () => {
    const { dealId, payload } = await createDeal();
    const a = await priceUpdate(dealId, payload, 21);
    const b = await priceUpdate(dealId, payload, 22);
    const results = await Promise.all([a, b].map((p) => approveProposal(db, p.id)));
    const conflicts = results.filter((r) => r.conflict);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.conflict).toContain('priceAmount');
    const [winner, loser] = results[0]?.conflict ? [b, a] : [a, b];
    expect(await proposal(loser.id)).toMatchObject({
      status: 'pending',
      reviewNote: conflicts[0]?.conflict,
      approvedPayload: null,
    });
    const [published] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(published?.priceAmount).toBe(winner.payload.deal.priceAmount);
  });

  it('applies an audited end observation to a deal that still has a future advertised deadline', async () => {
    const { dealId, payload } = await createDeal();
    const endsAt = '2026-12-01T00:00:00.000Z';
    await db
      .update(deals)
      .set({ endsAt: new Date(endsAt) })
      .where(eq(deals.id, dealId));
    const observedEndedAt = '2026-11-22T06:00:00.000Z';
    const id = await file(
      { ...payload, deal: { ...payload.deal, endsAt, observedEndedAt } },
      {
        kind: 'update',
        dealId,
        shadowDecision: decision('auto_approve'),
        changes: [{ field: 'observedEndedAt', before: null, after: observedEndedAt }],
      },
    );
    expect((await approveProposal(db, id, undefined, undefined, 'ai')).conflict).toBeNull();
    expect(await proposal(id)).toMatchObject({
      reviewedBy: 'ai',
      reviewEdited: false,
      payload: { deal: { verified: false } },
      approvedPayload: { deal: { verified: true, observedEndedAt, endsAt } },
    });
  });

  it('leaves an unsigned offer pending when another quoted value changed after audit', async () => {
    const { dealId, payload } = await createDeal();
    const update = await priceUpdate(dealId, payload, 28);
    await db.update(deals).set({ originalAmount: 70 }).where(eq(deals.id, dealId));
    expect((await approveProposal(db, update.id, undefined, undefined, 'ai')).conflict).toContain(
      'originalAmount',
    );
    const [published] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(published).toMatchObject({ originalAmount: 70, priceAmount: 40, verified: false });
    expect(await proposal(update.id)).toMatchObject({
      status: 'pending',
      reviewedAt: null,
      reviewEdited: null,
    });
  });

  it('rejects edits outside the reviewed fields and accepts legacy candidates without observedEndedAt', async () => {
    const { dealId, payload } = await createDeal();
    const update = await priceUpdate(dealId, payload, 28);
    for (const change of [
      { product: { ...payload.product, name: 'other' } },
      { event: 'other' },
      { deal: { ...update.payload.deal, currency: 'CAD' } },
    ]) {
      await expect(
        approveProposal(db, update.id, { ...update.payload, ...change }),
      ).rejects.toThrow();
    }
    expect((await proposal(update.id)).status).toBe('pending');
    const legacy = candidate();
    const old: Partial<typeof legacy.deal> = { ...legacy.deal };
    delete old.observedEndedAt;
    const id = await file({ ...legacy, deal: old as typeof legacy.deal });
    expect((await approveProposal(db, id, legacy)).conflict).toBeNull();
    expect(await proposal(id)).toMatchObject({
      reviewEdited: false,
      approvedPayload: { deal: { observedEndedAt: null } },
    });
    expect((await proposal(id)).payload?.deal).not.toHaveProperty('observedEndedAt');
  });

  it('records the one successful rejection and never rewrites a terminal decision', async () => {
    const id = await file(candidate(), { shadowDecision: decision('auto_reject') });
    const outcomes = await Promise.all([
      rejectProposal(db, id, 'first', 'ai'),
      rejectProposal(db, id, 'second', 'ai'),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(await proposal(id)).toMatchObject({
      status: 'rejected',
      reviewedBy: 'ai',
      approvedPayload: null,
    });
    expect((await approveProposal(db, id)).conflict).toBeTruthy();
  });
});
