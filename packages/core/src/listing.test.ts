import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  effectiveDiscountPercent,
  filterDeals,
  filtersToParams,
  formatMoney,
  parseFilters,
} from './listing.ts';
import { type DealView, dealSchema } from './schema.ts';

function deal(id: number, patch: Partial<DealView> = {}): DealView {
  return {
    id,
    rank: id * 10,
    status: 'published',
    plan: { zh: 'Pro 买断', en: 'Pro lifetime' },
    priceAmount: 50,
    originalAmount: 100,
    currency: 'USD',
    billing: 'one_time',
    discountPercent: 50,
    discountAmount: null,
    code: null,
    noCode: true,
    startsOn: '2026-11-01',
    endsOn: '2026-12-31',
    startsAt: null,
    endsAt: null,
    dateZone: null,
    observedLiveOn: null,
    oneTime: true,
    existingUsers: false,
    terms: { zh: '条款', en: 'Terms' },
    renewal: null,
    eligibility: null,
    cardNote: null,
    merchantUrl: 'https://example.com',
    sourceUrl: null,
    verified: true,
    checkedOn: '2026-11-19',
    product: {
      id,
      slug: `p${id}`,
      name: `Product ${id}`,
      category: 'developer',
      website: null,
      summary: { zh: '数据库客户端', en: 'Database client' },
      logoPath: null,
    },
    event: { id: 1, slug: 'bfcm-2026', kind: 'seasonal', name: { zh: '黑五', en: 'BFCM' } },
    ...patch,
  };
}

const now = new Date('2026-11-20T00:00:00Z');

describe('filters', () => {
  it('round-trips through URL params and drops defaults', () => {
    const f = { ...DEFAULT_FILTERS, category: 'ai' as const, status: 'ending' as const, q: 'pdf' };
    const params = filtersToParams(f);
    expect(params.toString()).toBe('category=ai&status=ending&q=pdf');
    expect(parseFilters(params)).toEqual(f);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('ignores unknown values', () => {
    expect(parseFilters({ category: 'nope', status: 'x', sort: 'y' })).toEqual(DEFAULT_FILTERS);
  });

  it('hides ended deals by default and searches across locales', () => {
    const list = [
      deal(1),
      deal(2, { endsOn: '2026-11-10', startsOn: '2026-11-01' }),
      deal(3, { product: { ...deal(3).product, summary: { zh: '笔记', en: 'Notes app' } } }),
    ];
    expect(filterDeals(list, DEFAULT_FILTERS, now).map((d) => d.id)).toEqual([1, 3]);
    expect(
      filterDeals(list, { ...DEFAULT_FILTERS, status: 'ended' }, now).map((d) => d.id),
    ).toEqual([2]);
    expect(filterDeals(list, { ...DEFAULT_FILTERS, q: 'notes' }, now).map((d) => d.id)).toEqual([
      3,
    ]);
    expect(filterDeals(list, { ...DEFAULT_FILTERS, q: '数据库' }, now).map((d) => d.id)).toEqual([
      1,
    ]);
  });

  it('sorts by discount with derived percentages', () => {
    const list = [
      deal(1, { discountPercent: 20 }),
      deal(2, { discountPercent: null, priceAmount: 25, originalAmount: 100 }),
      deal(3, { discountPercent: 40 }),
    ];
    expect(effectiveDiscountPercent(list[1] as DealView)).toBe(75);
    expect(
      filterDeals(list, { ...DEFAULT_FILTERS, sort: 'discount' }, now).map((d) => d.id),
    ).toEqual([2, 3, 1]);
  });
});

describe('formatMoney', () => {
  it('keeps cents only when needed and uses narrow symbols', () => {
    expect(formatMoney(47.4, 'USD', 'en')).toBe('$47.40');
    expect(formatMoney(59, 'USD', 'zh')).toBe('$59');
    expect(formatMoney(17.7, 'EUR', 'en')).toBe('€17.70');
  });
});

describe('dealSchema', () => {
  const { id, rank, status, product, event, ...valid } = deal(1);
  it('accepts a complete deal', () => {
    expect(dealSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects contradictory fields', () => {
    const bad = dealSchema.safeParse({ ...valid, code: 'BF', noCode: true, currency: null });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0]).sort()).toEqual(['currency', 'noCode']);
  });
  it('requires https merchant links', () => {
    expect(dealSchema.safeParse({ ...valid, merchantUrl: 'http://example.com' }).success).toBe(
      false,
    );
  });
});
