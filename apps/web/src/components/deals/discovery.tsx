import {
  type CategorySlug,
  type DealView,
  filterDeals,
  filtersToParams,
  type ListFilters,
} from '@deals/core';
import { SearchX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Link } from '@/i18n/navigation';
import { dealHref, toLocale } from '@/lib/deal-view';
import { JsonLd, pageUrl } from '@/lib/seo';
import { DealCard } from './deal-card';
import { FilterBar, LoadMore } from './filter-bar';

export const PAGE_SIZE = 12;
const MAX_PAGE = 50;

/** `?page=n` shows the first n * 12 results; anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number.parseInt(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_PAGE) : 1;
}

/**
 * Filter bar, result grid and "load more" over a pre-scoped list of deals. Filtering happens here
 * on the server, so every filter state is a shareable URL.
 */
export function Discovery({
  deals,
  filters,
  page,
  basePath,
  fixedCategory,
  hideSearch = false,
  now,
}: {
  deals: readonly DealView[];
  filters: ListFilters;
  page: number;
  /** Unprefixed path of the page the list lives on, e.g. `/` or `/category/ai`. */
  basePath: string;
  fixedCategory?: CategorySlug;
  hideSearch?: boolean;
  now: Date;
}) {
  const t = useTranslations('discover');
  const locale = toLocale(useLocale());
  const effective = fixedCategory ? { ...filters, category: fixedCategory } : filters;
  const matches = filterDeals(deals, effective, now);
  const shown = matches.slice(0, PAGE_SIZE * page);

  const params = filtersToParams(filters);
  if (fixedCategory) params.delete('category');
  const query = (extra?: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(extra ?? {})) next.set(key, value);
    const text = next.toString();
    return text ? `${basePath}?${text}` : basePath;
  };

  return (
    <div className="group/discovery space-y-5">
      <FilterBar
        filters={filters}
        fixedCategory={fixedCategory}
        hideSearch={hideSearch}
        total={matches.length}
      />
      <div
        id="results"
        className="transition-opacity group-has-[[data-pending=true]]/discovery:opacity-60"
      >
        {shown.length ? (
          <ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((deal) => (
              <li key={deal.id} className="min-w-0">
                <DealCard deal={deal} now={now} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="rounded-2xl border bg-card py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">{t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('emptyText')}</EmptyDescription>
            </EmptyHeader>
            <Link
              href={basePath}
              className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              {t('clear')}
            </Link>
          </Empty>
        )}
      </div>
      {shown.length < matches.length && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t('shown', { shown: shown.length, total: matches.length })}
          </p>
          <LoadMore href={query({ page: String(page + 1) })}>{t('more')}</LoadMore>
        </div>
      )}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          numberOfItems: matches.length,
          itemListElement: shown.map((deal, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: deal.product.name,
            url: pageUrl(dealHref(deal.product.slug, deal.id), locale),
          })),
        }}
      />
    </div>
  );
}
