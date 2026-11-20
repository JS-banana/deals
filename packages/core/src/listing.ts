import { CATEGORIES, type CategorySlug, type DealView, isCategory, type Locale } from './schema.ts';
import { dealState, endInstant, isEndingSoon } from './status.ts';

export const STATUS_FILTERS = ['active', 'live', 'ending', 'upcoming', 'ended'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORTS = ['curated', 'ending', 'discount', 'price'] as const;
export type Sort = (typeof SORTS)[number];

export interface ListFilters {
  category: CategorySlug | null;
  status: StatusFilter;
  q: string;
  existing: boolean;
  lifetime: boolean;
  sort: Sort;
}

export const DEFAULT_FILTERS: ListFilters = {
  category: null,
  status: 'active',
  q: '',
  existing: false,
  lifetime: false,
  sort: 'curated',
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Parse untrusted query params; anything unknown falls back to the default. */
export function parseFilters(params: Params): ListFilters {
  const status = read(params, 'status');
  const sort = read(params, 'sort');
  const category = read(params, 'category');
  return {
    category: isCategory(category) ? category : null,
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'active',
    q: (read(params, 'q') ?? '').slice(0, 100),
    existing: read(params, 'existing') === '1',
    lifetime: read(params, 'lifetime') === '1',
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : 'curated',
  };
}

/** Inverse of `parseFilters`, omitting defaults so URLs stay short. */
export function filtersToParams(f: ListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.category) params.set('category', f.category);
  if (f.status !== 'active') params.set('status', f.status);
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.existing) params.set('existing', '1');
  if (f.lifetime) params.set('lifetime', '1');
  if (f.sort !== 'curated') params.set('sort', f.sort);
  return params;
}

export function effectiveDiscountPercent(
  d: Pick<DealView, 'discountPercent' | 'priceAmount' | 'originalAmount'>,
): number | null {
  if (d.discountPercent !== null) return d.discountPercent;
  if (d.priceAmount !== null && d.originalAmount)
    return Math.round((1 - d.priceAmount / d.originalAmount) * 100);
  return null;
}

function searchText(d: DealView): string {
  const category = CATEGORIES.find((c) => c.slug === d.product.category);
  return [
    d.product.name,
    d.product.summary.zh,
    d.product.summary.en,
    d.plan.zh,
    d.plan.en,
    d.terms.zh,
    d.terms.en,
    d.eligibility?.zh,
    d.eligibility?.en,
    d.code,
    category?.name.zh,
    category?.name.en,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterDeals(deals: readonly DealView[], f: ListFilters, now: Date): DealView[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = deals.filter((d) => {
    if (f.category && d.product.category !== f.category) return false;
    if (f.existing && !d.existingUsers) return false;
    if (f.lifetime && !d.oneTime) return false;
    const state = dealState(d, now);
    if (f.status === 'active' && state === 'ended') return false;
    if (f.status === 'ended' && state !== 'ended') return false;
    if ((f.status === 'live' || f.status === 'upcoming') && state !== f.status) return false;
    if (f.status === 'ending' && !isEndingSoon(d, now)) return false;
    if (words.length) {
      const text = searchText(d);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  return sortDeals(list, f.sort);
}

export function sortDeals(list: DealView[], sort: Sort): DealView[] {
  const byRank = (a: DealView, b: DealView) => a.rank - b.rank || a.id - b.id;
  const nullsLast = (v: number | null) => v ?? Number.POSITIVE_INFINITY;
  const compare: Record<Sort, (a: DealView, b: DealView) => number> = {
    curated: byRank,
    ending: (a, b) => endInstant(a) - endInstant(b) || byRank(a, b),
    discount: (a, b) =>
      (effectiveDiscountPercent(b) ?? -1) - (effectiveDiscountPercent(a) ?? -1) || byRank(a, b),
    price: (a, b) => nullsLast(a.priceAmount) - nullsLast(b.priceAmount) || byRank(a, b),
  };
  return list.sort(compare[sort]);
}

const moneyFormats = new Map<string, Intl.NumberFormat>();
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  const fraction = Number.isInteger(amount) ? 0 : 2;
  const key = `${locale}:${currency}:${fraction}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    });
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}
