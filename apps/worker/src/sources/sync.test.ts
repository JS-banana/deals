import { randomUUID } from 'node:crypto';
import { calendarDay, dealSchema } from '@deals/core';
import {
  approveProposal,
  createDb,
  deals,
  dealVotes,
  eq,
  events,
  fileProposal,
  inArray,
  listDeals,
  pageSnapshots,
  products,
  proposals,
  rawSignals,
  sql,
  syncState,
} from '@deals/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { offerKeyFor } from '../extract.ts';
import type { Llm } from '../llm.ts';
import { pruneSnapshots } from '../prune.ts';
import { recheck } from '../recheck.ts';
import { reviewPending } from '../review-pending.ts';
import { reviewProposal } from '../review-proposal.ts';
import type { Ctx } from '../runtime.ts';
import { loadConfig } from '../runtime.ts';
import { type Catalog, entryKey, loadCatalog, UPSTREAM_REPO } from '../upstream.ts';
import { syncSource } from './sync.ts';
import type { SourceConfig } from './types.ts';

const databaseUrl = process.env.REVIEW_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('source pipeline with PostgreSQL', () => {
  const prefix = `offer-test-${randomUUID()}`;
  const host = `${prefix}.example`;
  const benefit = '新客户可获 300 美元赠金';
  const github = {
    id: `${prefix}-github`,
    type: 'github',
    enabled: true,
    target: 'owner/list',
    quota: 15,
  } as const;
  const rss = {
    id: `${prefix}-rss`,
    type: 'rss',
    enabled: true,
    target: `https://${host}/feed`,
    quota: 15,
  } as const;
  let db: ReturnType<typeof createDb>;
  let ctx: Ctx;
  const llm: Llm = {
    async json(request) {
      if (request.system.startsWith('Classify')) {
        const rows = JSON.parse(request.user) as Array<{ id: number; candidateUrls: string[] }>;
        return request.parse({
          results: rows.map((r) => ({
            id: r.id,
            isDeal: true,
            productName: prefix,
            offerType: 'free_credit',
            merchantUrl: r.candidateUrls[0],
          })),
        });
      }
      const discount = request.user.includes('/subscription');
      return request.parse({
        product: { category: 'developer', summary: '软件' },
        deal: {
          plan: discount ? '专业年付' : '开发者额度',
          billing: 'other',
          terms: '请见商家页',
          offerType: discount ? 'discount' : 'free_credit',
          discountPercent: discount ? 30 : null,
          benefitSummary: discount ? null : benefit,
        },
        evidence: [
          discount
            ? { field: 'discountPercent', quote: '30% off' }
            : { field: 'benefitSummary', quote: benefit },
        ],
        confidence: 0.97,
      });
    },
  };
  beforeAll(async () => {
    db = createDb(databaseUrl);
    await db.insert(events).values({
      slug: prefix,
      name: { zh: '测试', en: 'test' },
      tagline: { zh: '测试', en: 'test' },
      kind: 'evergreen',
    });
    const feed =
      '<rss><channel>' +
      ['announcement', 'subscription']
        .map(
          (k) =>
            `<item><guid>${k}</guid><link>https://${host}/${k}</link><title>${prefix} ${k}</title><description>${k}</description></item>`,
        )
        .join('') +
      '</channel></rss>';
    ctx = {
      job: 'test',
      db,
      dryRun: false,
      config: loadConfig({}),
      signal: new AbortController().signal,
      stats: {},
      log: () => {},
      extractLlm: llm,
      translateLlm: {
        json: async () => {
          throw new Error('offline');
        },
      },
      reviewLlm: {
        json: async (request) =>
          request.parse({
            verdict: 'approve',
            score: 95,
            dims: { accuracy: 95, billingAndTerms: 95, relevance: 95, copyQuality: 95 },
            issues: [],
            summary: 'approved',
          }),
      },
      fetcher: {
        raw: async (url) => ({
          url,
          status: 200,
          truncated: false,
          contentType: 'text/plain',
          body: new TextEncoder().encode(
            url.includes('api.github.com')
              ? 'a'.repeat(40)
              : url.includes('raw.githubusercontent')
                ? `- [${prefix}](https://${host}/claim) - development credits`
                : feed,
          ),
        }),
        page: async (url) => ({
          url,
          status: 200,
          title: 'Merchant',
          text: `${benefit}\n30% off`,
          error: null,
          hash: prefix,
          icons: [],
        }),
      },
    };
  });
  afterAll(async () => {
    const ids = [github.id, rss.id];
    try {
      await db.delete(proposals).where(sql`payload->'product'->>'slug' = ${prefix}`);
      await db.delete(products).where(eq(products.slug, prefix));
      await db.delete(pageSnapshots).where(sql`url like ${`https://${host}/%`}`);
      await db.delete(rawSignals).where(inArray(rawSignals.sourceId, ids));
      await db.delete(syncState).where(
        inArray(
          syncState.key,
          ids.map((id) => `source:${id}`),
        ),
      );
      await db.delete(events).where(eq(events.slug, prefix));
    } finally {
      await db.$client.end();
    }
  });
  async function run(source: SourceConfig, dryRun = false) {
    const catalog = await loadCatalog(ctx);
    catalog.events = catalog.events.filter((e) => e.slug === prefix);
    await syncSource({ ...ctx, dryRun }, source, catalog);
  }
  const filed = () =>
    db.select().from(proposals).where(sql`payload->'product'->>'slug' = ${prefix}`);

  describe('legacy GitHub cursor migration', () => {
    const source = { ...github, id: 'github-bfcm' };
    const legacyKey = 'upstream:awesome-bfcm';
    const sourceKey = `source:${source.id}`;
    const head = 'a'.repeat(40);

    async function withLegacyState(
      value: { sha: string; processed?: string[] },
      test: (testCtx: Ctx, catalog: Catalog) => Promise<void>,
    ) {
      const rollback = new Error('rollback legacy cursor fixture');
      await expect(
        db.transaction(async (tx) => {
          // The source ID is fixed. Roll back both fixture writes and any existing state we clear.
          await tx.delete(rawSignals).where(eq(rawSignals.sourceId, source.id));
          await tx.delete(syncState).where(inArray(syncState.key, [legacyKey, sourceKey]));
          await tx.insert(syncState).values({ key: legacyKey, value });
          const testCtx: Ctx = {
            ...ctx,
            db: Object.assign(tx, { $client: db.$client }),
            stats: {},
          };
          const catalog = await loadCatalog(testCtx);
          catalog.events = catalog.events.filter((event) => event.slug === prefix);
          await test(testCtx, catalog);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    }

    it('persists the legacy cursor without fetching the README when HEAD matches', async () => {
      const legacy = { sha: head };
      await withLegacyState(legacy, async (testCtx, catalog) => {
        const raw = vi.fn(testCtx.fetcher.raw);
        testCtx.fetcher = { ...testCtx.fetcher, raw };

        await syncSource(testCtx, source, catalog);

        expect(raw).toHaveBeenCalledExactlyOnceWith(
          `https://api.github.com/repos/${source.target}/commits/HEAD`,
          expect.anything(),
        );
        expect(testCtx.stats[`queued:${source.id}`]).toBe(0);
        expect(
          await testCtx.db.select().from(rawSignals).where(eq(rawSignals.sourceId, source.id)),
        ).toHaveLength(0);
        const states = await testCtx.db
          .select({ key: syncState.key, value: syncState.value })
          .from(syncState)
          .where(inArray(syncState.key, [legacyKey, sourceKey]));
        expect(states).toEqual(
          expect.arrayContaining([
            { key: sourceKey, value: head },
            { key: legacyKey, value: legacy },
          ]),
        );
      });
    });

    it('marks legacy entries processed and sends only new entries to extraction', async () => {
      const oldName = `${prefix}-legacy`;
      const oldUrl = `https://${host}/legacy`;
      const newUrl = `https://${host}/claim`;
      await withLegacyState(
        { sha: 'b'.repeat(40), processed: [entryKey(oldName, oldUrl)] },
        async (testCtx, catalog) => {
          const page = vi.fn(testCtx.fetcher.page);
          testCtx.fetcher = {
            page,
            raw: async (url, options) => {
              const result = await ctx.fetcher.raw(url, options);
              return url.includes('raw.githubusercontent')
                ? {
                    ...result,
                    body: Buffer.from(
                      `- [${oldName}](${oldUrl}) - legacy offer\n- [${prefix}](${newUrl}) - development credits`,
                    ),
                  }
                : result;
            },
          };
          const readSignals = () =>
            testCtx.db.select().from(rawSignals).where(eq(rawSignals.sourceId, source.id));

          const preview: Ctx = { ...testCtx, dryRun: true, stats: {} };
          await syncSource(preview, source, catalog);
          expect(preview.stats[`queued:${source.id}`]).toBe(1);
          expect(page).toHaveBeenCalledExactlyOnceWith(newUrl);
          expect(await readSignals()).toHaveLength(0);
          page.mockClear();

          await syncSource(testCtx, source, catalog);

          expect(testCtx.stats[`queued:${source.id}`]).toBe(1);
          expect(testCtx.stats.proposals).toBe(1);
          expect(page).toHaveBeenCalledExactlyOnceWith(newUrl);
          const signals = await readSignals();
          expect(signals).toHaveLength(2);
          expect(signals.find((row) => row.signal.title === oldName)?.processedAt).toBeInstanceOf(
            Date,
          );
          expect(signals.find((row) => row.signal.title === prefix)?.processedAt).toBeInstanceOf(
            Date,
          );
        },
      );
    });
  });

  it('replays two feeds, merges a repost and publishes two different offers without losing their evidence', async () => {
    await run(github, true);
    expect(await filed()).toHaveLength(0);
    expect(
      await db.select().from(rawSignals).where(eq(rawSignals.sourceId, github.id)),
    ).toHaveLength(0);
    await run(github);
    await run(rss);
    const proposalsBefore = await filed();
    expect(proposalsBefore).toHaveLength(2);
    expect(proposalsBefore.map((p) => p.payload?.deal.offerType).sort()).toEqual([
      'discount',
      'free_credit',
    ]);
    expect(proposalsBefore.every((p) => p.status === 'pending' && p.snapshotId != null)).toBe(true);
    expect(
      (
        await db
          .select()
          .from(rawSignals)
          .where(inArray(rawSignals.sourceId, [github.id, rss.id]))
      ).filter((r) => r.processedAt),
    ).toHaveLength(3);
    // A failed automatic approval rolls back the insert. Retrying the same dedupe key is safe.
    const credit = proposalsBefore.find((p) => p.payload?.deal.offerType === 'free_credit');
    if (!credit?.payload || !credit.snapshotId || !credit.auditInputs)
      throw new Error('missing credit fixture');
    const grantDeal = credit.payload.deal;
    const grantKey = (zh: string) => offerKeyFor({ ...grantDeal, benefitSummary: { zh, en: '' } });
    expect(grantKey('获赠 300 美元 API 赠金')).toBe(grantKey('领取 USD 300 试用金'));
    expect(grantKey('获赠 300 美元 API 赠金')).not.toBe(grantKey('获赠 30 美元 API 赠金'));
    const retry = {
      kind: 'create' as const,
      snapshotId: credit.snapshotId,
      changes: [],
      evidence: credit.evidence,
      confidence: 0.97,
      reason: 'transaction retry fixture',
      sourceRef: credit.sourceRef ?? '',
      dedupeKey: `${prefix}-retry`,
      payload: { ...credit.payload, event: `missing-${prefix}` },
      auditInputs: { ...credit.auditInputs, notes: [] },
    };
    const live = { ...ctx, config: { ...ctx.config, auto: { ...ctx.config.auto, create: true } } };
    await expect(reviewProposal(live, retry, benefit)).rejects.toThrow('未知活动');
    expect(await filed()).toHaveLength(2);
    // The retried candidate belongs to a different (explicitly named) grant.
    retry.payload = {
      ...credit.payload,
      deal: { ...credit.payload.deal, offerKey: 'retry-grant' },
    };
    await expect(reviewProposal(live, retry, benefit)).resolves.toBe(true);
    expect(await reviewProposal(live, retry, benefit)).toBe(false);
    const [retried] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.dedupeKey, retry.dedupeKey));
    expect(retried).toMatchObject({ status: 'approved', reviewedBy: 'ai' });
    if (!retried?.dealId) throw new Error('missing published retry');
    await db.delete(deals).where(eq(deals.id, retried.dealId));
    for (const proposal of proposalsBefore)
      expect((await approveProposal(db, proposal.id)).conflict).toBeNull();
    await run(github);
    await run(rss);
    expect(await filed()).toHaveLength(2);
    expect(await listDeals(db, { productSlug: prefix })).toHaveLength(2);
    const url = `https://${host}/claim`;
    const old = new Date(Date.now() - 40 * 86400000);
    // Keep all pruning inside a rollback, even on a shared test database.
    let checked = false;
    await expect(
      db.transaction(async (tx) => {
        await tx.update(pageSnapshots).set({ fetchedAt: old }).where(eq(pageSnapshots.url, url));
        const captures = await tx
          .insert(pageSnapshots)
          .values(
            ['first', 'latest'].map((text) => ({ url, text, fetchedAt: old, contentHash: text })),
          )
          .returning();
        await pruneSnapshots(tx);
        const rows = await tx.select().from(pageSnapshots).where(eq(pageSnapshots.url, url));
        expect(rows.find((r) => r.id === captures[0]?.id)).toMatchObject({
          text: null,
          contentHash: 'first',
        });
        expect(rows.find((r) => r.id === captures[1]?.id)?.text).toBe('latest');
        expect(
          rows.find(
            (r) =>
              r.id ===
              proposalsBefore.find((p) => p.payload?.deal.offerType === 'free_credit')?.snapshotId,
          )?.text,
        ).toContain(benefit);
        checked = true;
        throw new Error('rollback fixture');
      }),
    ).rejects.toThrow('rollback fixture');
    expect(checked).toBe(true);

    // Two independent reports put this offer ahead of the rest of the catalog.
    const [grant] = (await listDeals(db, { productSlug: prefix })).filter(
      (d) => d.offerType === 'free_credit',
    );
    if (!grant) throw new Error('missing grant');
    await db
      .insert(dealVotes)
      .values(['a', 'b'].map((voterHash) => ({ voterHash, valid: false, dealId: grant.id })));
    let requested: string | undefined;
    const foreign = 'https://unconfirmed.example/archived';
    const checkCtx: Ctx = {
      ...ctx,
      limit: 1,
      config: { ...ctx.config, auto: { ...ctx.config.auto, update: true } },
      fetcher: {
        ...ctx.fetcher,
        page: async (url) => {
          requested = url;
          return {
            ...(await ctx.fetcher.page(url)),
            url: foreign,
            hash: 'end-on-another-site',
            text: `${benefit} Offer has ended.`,
          };
        },
      },
      extractLlm: {
        json: async (r) =>
          r.parse({
            offerStillValid: false,
            confidence: 1,
            evidence: [
              { field: 'benefitSummary', quote: benefit },
              { field: 'observedEndedAt', quote: 'Offer has ended.' },
            ],
          }),
      },
    };
    await recheck(checkCtx);
    expect(requested).toBe(grant.merchantUrl);
    expect((await filed()).find((p) => p.kind === 'update')).toMatchObject({
      status: 'pending',
      shadowDecision: { action: 'manual_review' },
      auditInputs: { notes: ['复查跳转至未经确认的商家域名'] },
    });
    expect(
      (await listDeals(db, { productSlug: prefix })).find((d) => d.id === grant.id)
        ?.observedEndedAt,
    ).toBeNull();
  });

  it.each([
    { status: 200, error: null, text: 'Course description and syllabus' },
    { status: 200, error: 'empty-text', text: 'Loading' },
    { status: 403, error: 'http-403', text: '' },
    { status: 429, error: 'http-429', text: '' },
  ])('bypasses triage and publishes curated course evidence with $status $error', async (page) => {
    const source = { ...github, id: `${prefix}-curated`, curated: true };
    const title = `${prefix}-course`;
    const url = `https://${host}/course`;
    const quote = '50% off with code LEARN50';
    const extract: Llm['json'] = async (request) => {
      // Fail the row if any LLM triage request was made.
      expect(request.system).toContain('Include all valid curated Black Friday deals');
      expect(request.user).toContain(quote);
      return request.parse({
        product: { category: 'developer', summary: '学习开发工具的课程' },
        deal: {
          plan: '课程',
          billing: 'other',
          terms: '使用优惠码 LEARN50。',
          discountPercent: 50,
          code: 'LEARN50',
        },
        evidence: ['discountPercent', 'code'].map((field) => ({ field, quote })),
        confidence: 0.94,
      });
    };
    const extractLlm = { json: extract };
    const extraction = vi.spyOn(extractLlm, 'json');
    const rollback = new Error('rollback curated fixture');
    await expect(
      db.transaction(async (tx) => {
        const testCtx: Ctx = {
          ...ctx,
          db: Object.assign(tx, { $client: db.$client }),
          stats: {},
          config: { ...ctx.config, auto: { ...ctx.config.auto, create: true } },
          extractLlm,
          fetcher: {
            raw: async (requested, opts) => {
              const response = await ctx.fetcher.raw(requested, opts);
              return requested.includes('raw.githubusercontent')
                ? { ...response, body: Buffer.from(`- [${title}](${url}) - ${quote}`) }
                : response;
            },
            page: async (requested) => ({ ...(await ctx.fetcher.page(requested)), ...page }),
          },
        };
        const catalog = await loadCatalog(testCtx);
        catalog.events = catalog.events.filter((event) => event.slug === prefix);
        await syncSource(testCtx, source, catalog);
        expect(extraction).toHaveBeenCalledTimes(1);
        expect(testCtx.stats).toMatchObject({ autoApproved: 1, 'shadow:auto_approve': 1 });
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(sql`payload->'product'->>'slug' = ${title}`);
        expect(proposal).toMatchObject({
          status: 'approved',
          reviewedBy: 'ai',
          snapshotId: expect.any(Number),
          auditInputs: { sourceTrust: 'curated', dropped: 0, notes: [] },
          shadowDecision: { action: 'auto_approve', verified: false },
          evidence: [
            { field: 'discountPercent', quote, url: expect.stringContaining('github.com') },
            { field: 'code', quote, url: expect.stringContaining('github.com') },
          ],
        });
        expect(await listDeals(testCtx.db, { productSlug: title })).toMatchObject([
          { verified: false },
        ]);
        if (page.error) {
          expect(
            (await tx.select().from(pageSnapshots).where(eq(pageSnapshots.url, url)))[0],
          ).toMatchObject({
            text: null,
            error: page.error,
          });
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('watches the last ended offer on its official source page and renews its rank in the same event', async () => {
    const rollback = new Error('rollback renewal fixture');
    await expect(
      db.transaction(async (tx) => {
        const seasonal = `${prefix}-renewal`;
        await tx.insert(events).values({
          slug: seasonal,
          name: { zh: '测试活动', en: 'Test event' },
          tagline: { zh: '测试', en: 'Test' },
          kind: 'seasonal',
        });
        const name = `${prefix}-pinned`;
        const merchantUrl = `https://${host}/expired`;
        const sourceUrl = `https://gemini.${prefix}.example/subscriptions?hl=en`;
        const endsOn = (offset: number) => calendarDay(new Date(Date.now() + offset * 86_400_000));
        const historical = dealSchema.parse({
          plan: { zh: '专业版', en: '' },
          priceAmount: null,
          originalAmount: null,
          currency: null,
          billing: 'other',
          discountPercent: 30,
          discountAmount: null,
          code: null,
          noCode: false,
          startsOn: null,
          endsOn: endsOn(-2),
          startsAt: null,
          endsAt: null,
          dateZone: null,
          observedLiveOn: null,
          oneTime: false,
          existingUsers: false,
          terms: { zh: '专业版折扣。', en: '' },
          renewal: null,
          eligibility: null,
          cardNote: null,
          merchantUrl,
          sourceUrl,
          verified: false,
          checkedOn: endsOn(-3),
        });
        historical.offerKey = offerKeyFor(historical);
        for (const [key, date, source] of [
          [historical.offerKey, historical.endsOn, sourceUrl],
          ['older-offer', endsOn(-3), null],
        ] as const) {
          const id = await fileProposal(tx, {
            kind: 'create',
            payload: {
              product: {
                slug: name,
                name,
                category: 'developer',
                website: `https://${host}`,
                logoPath: null,
                summary: { zh: '开发工具', en: '' },
              },
              event: seasonal,
              deal: { ...historical, offerKey: key, endsOn: date, sourceUrl: source },
            },
            dedupeKey: `${name}:${key}`,
            reason: 'renewal fixture',
          });
          if (id === null) throw new Error('missing renewal fixture');
          const { dealId } = await approveProposal(tx, id);
          if (!dealId) throw new Error('missing historical deal');
          if (key === 'older-offer')
            await tx.update(deals).set({ rank: 0 }).where(eq(deals.id, dealId));
        }

        const extract: Llm['json'] = async (request) => {
          expect(request.user).toContain('PREVIOUS OFFER');
          expect(request.user).toContain(historical.endsOn);
          return request.parse({
            product: { category: 'developer', summary: '开发工具' },
            deal: {
              plan: historical.plan.zh,
              billing: historical.billing,
              terms: '页面显示活动价。',
              endsOn: endsOn(2),
              discountPercent: 30,
            },
            evidence: [
              { field: 'discountPercent', quote: '30% off' },
              { field: 'endsOn', quote: `Ends ${endsOn(2)}` },
            ],
            confidence: 0.95,
          });
        };
        const extractLlm = { json: extract };
        const extraction = vi.spyOn(extractLlm, 'json');
        const page = vi.fn(async (url: string) => ({
          ...(await ctx.fetcher.page(url)),
          ...(url === sourceUrl
            ? { text: `30% off\nEnds ${endsOn(2)}` }
            : { text: '', error: 'empty-text' }),
        }));
        const testCtx: Ctx = {
          ...ctx,
          db: Object.assign(tx, { $client: db.$client }),
          stats: {},
          config: { ...ctx.config, auto: { ...ctx.config.auto, create: true } },
          extractLlm,
          fetcher: { ...ctx.fetcher, page },
        };
        await recheck(testCtx);
        expect(page).toHaveBeenCalledWith(sourceUrl);
        expect(extraction).toHaveBeenCalledTimes(1);
        expect(testCtx.stats).toMatchObject({
          renewalChecked: 1,
          renewalProposals: 1,
          autoApproved: 1,
        });
        const current = await listDeals(testCtx.db, { productSlug: name, eventSlug: seasonal });
        expect(current).toHaveLength(3);
        const renewal = current.find((deal) => deal.endsOn === endsOn(2));
        expect(renewal).toMatchObject({ rank: 0, verified: true, sourceUrl });
        expect(renewal?.offerKey).toContain('-renewal-');
        expect(
          current.some(
            (deal) => deal.offerKey === historical.offerKey && deal.endsOn === historical.endsOn,
          ),
        ).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('falls back to product.website when watchRenewal merchantUrl and sourceUrl return empty-text', async () => {
    const rollback = new Error('rollback renewal fallback fixture');
    await expect(
      db.transaction(async (tx) => {
        const seasonal = `${prefix}-renewal-fallback`;
        await tx.insert(events).values({
          slug: seasonal,
          name: { zh: '测试活动', en: 'Test event' },
          tagline: { zh: '测试', en: 'Test' },
          kind: 'seasonal',
        });
        const name = `${prefix}-fallback`;
        const website = `https://${host}/plans`;
        const merchantUrl = `https://${host}/login-redirect`;
        const sourceUrl = `https://gemini.${prefix}.example/unavailable`;
        const endsOn = (offset: number) => calendarDay(new Date(Date.now() + offset * 86_400_000));
        const historical = dealSchema.parse({
          plan: { zh: '高级版', en: '' },
          priceAmount: null,
          originalAmount: null,
          currency: null,
          billing: 'other',
          discountPercent: 40,
          discountAmount: null,
          code: null,
          noCode: false,
          startsOn: null,
          endsOn: endsOn(-2),
          startsAt: null,
          endsAt: null,
          dateZone: null,
          observedLiveOn: null,
          oneTime: false,
          existingUsers: false,
          terms: { zh: '高级版折扣。', en: '' },
          renewal: null,
          eligibility: null,
          cardNote: null,
          merchantUrl,
          sourceUrl,
          verified: false,
          checkedOn: endsOn(-3),
        });
        historical.offerKey = offerKeyFor(historical);
        const id = await fileProposal(tx, {
          kind: 'create',
          payload: {
            product: {
              slug: name,
              name,
              category: 'developer',
              website,
              logoPath: null,
              summary: { zh: '开发工具', en: '' },
            },
            event: seasonal,
            deal: historical,
          },
          dedupeKey: `${name}:${historical.offerKey}`,
          reason: 'renewal fallback fixture',
        });
        if (id === null) throw new Error('missing fallback fixture');
        const { dealId } = await approveProposal(tx, id);
        if (!dealId) throw new Error('missing fallback deal');
        await tx.update(deals).set({ rank: 0 }).where(eq(deals.id, dealId));

        const extract: Llm['json'] = async (request) =>
          request.parse({
            product: { category: 'developer', summary: '开发工具' },
            deal: {
              plan: historical.plan.zh,
              billing: historical.billing,
              terms: '页面显示官网活动价。',
              endsOn: endsOn(3),
              discountPercent: 40,
            },
            evidence: [
              { field: 'discountPercent', quote: '40% off' },
              { field: 'endsOn', quote: `Ends ${endsOn(3)}` },
            ],
            confidence: 0.95,
          });
        const page = vi.fn(async (url: string) => ({
          ...(await ctx.fetcher.page(url)),
          ...(url === website
            ? { text: `40% off\nEnds ${endsOn(3)}` }
            : { text: '', error: 'empty-text' }),
        }));
        const testCtx: Ctx = {
          ...ctx,
          db: Object.assign(tx, { $client: db.$client }),
          stats: {},
          config: { ...ctx.config, auto: { ...ctx.config.auto, create: true } },
          extractLlm: { json: extract },
          fetcher: { ...ctx.fetcher, page },
        };
        await recheck(testCtx);
        expect(page.mock.calls.map((c) => c[0]).slice(-3)).toEqual([
          sourceUrl,
          merchantUrl,
          website,
        ]);
        expect(testCtx.stats).toMatchObject({
          renewalChecked: 1,
          renewalProposals: 1,
          autoApproved: 1,
        });
        const current = await listDeals(testCtx.db, { productSlug: name, eventSlug: seasonal });
        expect(current.find((d) => d.endsOn === endsOn(3))).toMatchObject({
          rank: 0,
          verified: true,
          merchantUrl: website,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('re-audits legacy curated pending proposals and auto-approves verified:false', async () => {
    const rollback = new Error('rollback reviewPending fixture');
    await expect(
      db.transaction(async (tx) => {
        const slug = `${prefix}-legacy-curated`;
        const merchantUrl = `https://legacy.${host}/deal`;
        const sourceRef = `https://github.com/${UPSTREAM_REPO}/blob/abc/README.md#L42`;
        const quote = '50% off with code LEGACY50';
        const deal = dealSchema.parse({
          plan: { zh: '专业版', en: 'Pro' },
          priceAmount: null,
          originalAmount: null,
          currency: null,
          billing: 'other',
          discountPercent: 50,
          discountAmount: null,
          code: 'LEGACY50',
          noCode: false,
          startsOn: null,
          endsOn: null,
          startsAt: null,
          endsAt: null,
          dateZone: null,
          observedLiveOn: null,
          oneTime: false,
          existingUsers: false,
          terms: { zh: '使用优惠码 LEGACY50。', en: 'Use code LEGACY50.' },
          renewal: null,
          eligibility: null,
          cardNote: null,
          merchantUrl,
          sourceUrl: sourceRef,
          verified: false,
          checkedOn: calendarDay(new Date()),
        });
        deal.offerKey = offerKeyFor(deal);
        const [snapshot] = await tx
          .insert(pageSnapshots)
          .values({ url: merchantUrl, httpStatus: 403, error: 'http-403', text: null })
          .returning({ id: pageSnapshots.id });
        const id = await fileProposal(tx, {
          kind: 'create',
          snapshotId: snapshot?.id ?? null,
          payload: {
            product: {
              slug,
              name: slug,
              category: 'developer',
              website: `https://legacy.${host}`,
              logoPath: null,
              summary: { zh: '开发效率工具', en: 'Dev productivity tool' },
            },
            event: prefix,
            deal,
          },
          evidence: [
            { field: 'discountPercent', url: sourceRef, quote },
            { field: 'code', url: sourceRef, quote },
          ],
          confidence: 0.45,
          auditInputs: {
            merchantUrl,
            upstreamText: `- [${slug}](${merchantUrl}) - ${quote}`,
            dropped: 0,
            notes: ['商家域名尚未经独立确认'],
          },
          reason: 'legacy curated fixture',
          sourceRef,
          dedupeKey: `${slug}:create`,
        });
        if (id === null) throw new Error('missing legacy proposal fixture');

        const testCtx: Ctx = {
          ...ctx,
          db: Object.assign(tx, { $client: db.$client }),
          stats: {},
          config: { ...ctx.config, auto: { ...ctx.config.auto, create: true } },
        };
        await reviewPending(testCtx);

        const [updated] = await tx.select().from(proposals).where(eq(proposals.id, id));
        expect(updated).toMatchObject({
          status: 'approved',
          reviewedBy: 'ai',
          confidence: 0.8,
          auditInputs: { sourceTrust: 'curated', notes: [] },
          shadowDecision: { action: 'auto_approve', verified: false },
        });
        expect(await listDeals(testCtx.db, { productSlug: slug })).toMatchObject([
          { verified: false },
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
