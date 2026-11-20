'use client';

import {
  CATEGORIES,
  type CategorySlug,
  DEFAULT_FILTERS,
  filtersToParams,
  type ListFilters,
  pick,
  SORTS,
  type Sort,
  STATUS_FILTERS,
  type StatusFilter,
} from '@deals/core';
import { ArrowDownUp, ChevronDown, LayoutGrid, Loader2, Search, X } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHydrated } from '@/hooks/use-hydrated';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { CATEGORY_UI, toLocale } from '@/lib/deal-view';

const isDefault = (f: ListFilters, fixed?: CategorySlug) =>
  (Boolean(fixed) || f.category === DEFAULT_FILTERS.category) &&
  f.status === DEFAULT_FILTERS.status &&
  !f.q.trim() &&
  !f.existing &&
  !f.lifetime &&
  f.sort === DEFAULT_FILTERS.sort;

/** A checkbox/radio drawn as a pill. The native input keeps it working without JavaScript. */
function Chip({
  type,
  name,
  value,
  checked,
  onChange,
  children,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer">
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-background px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:h-9 [&_svg]:size-4 [&_svg]:shrink-0">
        {children}
      </span>
    </label>
  );
}

/**
 * Filters are a real GET form: without JavaScript it submits and reloads. With JavaScript every
 * change updates the URL with `router.replace` inside a transition and shows a pending state.
 */
export function FilterBar({
  filters,
  fixedCategory,
  total,
}: {
  filters: ListFilters;
  /** Set on category pages: the category is part of the path, so its chips are hidden. */
  fixedCategory?: CategorySlug;
  total: number;
}) {
  const t = useTranslations('discover');
  const locale = toLocale(useLocale());
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useOptimistic(filters);
  const [q, setQ] = useState(filters.q);
  const latest = useRef(view);
  const sentQ = useRef(filters.q);
  const timer = useRef<number | undefined>(undefined);
  const composing = useRef(false);

  useEffect(() => {
    latest.current = view;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Follow the URL when it changes from outside (back button, "clear filters"), but never while
  // our own newer query is still in flight.
  useEffect(() => {
    if (!pending && filters.q !== sentQ.current) {
      sentQ.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q, pending]);

  function navigate(next: ListFilters) {
    const params = filtersToParams(next);
    if (fixedCategory) params.delete('category');
    const query = params.toString();
    sentQ.current = next.q.trim();
    startTransition(() => {
      setView(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  const set = (patch: Partial<ListFilters>) => navigate({ ...latest.current, q, ...patch });

  function onQuery(value: string) {
    setQ(value);
    window.clearTimeout(timer.current);
    if (composing.current) return;
    timer.current = window.setTimeout(() => navigate({ ...latest.current, q: value }), 350);
  }

  return (
    <search aria-label={t('label')}>
      <form
        action={pathname}
        method="get"
        data-pending={pending}
        onSubmit={(event) => {
          event.preventDefault();
          window.clearTimeout(timer.current);
          navigate({ ...latest.current, q });
        }}
        className="space-y-3 rounded-2xl border bg-card p-3 sm:p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="deal-q" className="sr-only">
              {t('searchLabel')}
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="deal-q"
              type="search"
              name="q"
              value={q}
              enterKeyHint="search"
              autoComplete="off"
              placeholder={t('searchPlaceholder')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                onQuery(event.currentTarget.value);
              }}
              className="h-11 rounded-xl pl-10 text-base sm:text-sm"
            />
          </div>
          <div className="relative sm:w-48">
            <label htmlFor="deal-sort" className="sr-only">
              {t('sortLabel')}
            </label>
            <ArrowDownUp
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <select
              id="deal-sort"
              name="sort"
              value={view.sort}
              onChange={(event) => set({ sort: event.target.value as Sort })}
              className="h-11 w-full appearance-none rounded-xl border border-input bg-transparent pr-9 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm dark:bg-input/30"
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`sort.${sort}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        {!fixedCategory && (
          <fieldset className="-mx-3 min-w-0 px-3 sm:mx-0 sm:px-0">
            <legend className="sr-only">{t('categoryLabel')}</legend>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
              <Chip
                type="radio"
                name="category"
                value=""
                checked={view.category === null}
                onChange={() => set({ category: null })}
              >
                <LayoutGrid aria-hidden="true" />
                {t('all')}
              </Chip>
              {CATEGORIES.map((category) => {
                const Icon = CATEGORY_UI[category.slug].icon;
                return (
                  <Chip
                    key={category.slug}
                    type="radio"
                    name="category"
                    value={category.slug}
                    checked={view.category === category.slug}
                    onChange={() => set({ category: category.slug })}
                  >
                    <Icon aria-hidden="true" />
                    {pick(category.name, locale)}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <fieldset className="-mx-3 max-w-[calc(100%+1.5rem)] min-w-0 px-3 sm:mx-0 sm:max-w-full sm:px-0">
            <legend className="sr-only">{t('statusLabel')}</legend>
            <div className="flex w-max gap-0.5 rounded-xl bg-muted p-1">
              {STATUS_FILTERS.map((status: StatusFilter) => (
                <label key={status} className="relative inline-flex cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    value={status}
                    checked={view.status === status}
                    onChange={() => set({ status })}
                    className="peer sr-only"
                  />
                  <span className="inline-flex h-10 items-center rounded-lg px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors select-none hover:text-foreground peer-checked:bg-card peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-xs peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:h-8">
                    {t(`status.${status}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Chip
              type="checkbox"
              name="lifetime"
              value="1"
              checked={view.lifetime}
              onChange={() => set({ lifetime: !view.lifetime })}
            >
              {t('lifetime')}
            </Chip>
            <Chip
              type="checkbox"
              name="existing"
              value="1"
              checked={view.existing}
              onChange={() => set({ existing: !view.existing })}
            >
              {t('existing')}
            </Chip>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums"
            >
              {pending && (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span className="sr-only">{t('updating')}</span>
                </>
              )}
              {t('count', { count: total })}
            </p>
            {!isDefault(view, fixedCategory) && (
              <Link
                href={pathname}
                scroll={false}
                onClick={(event) => {
                  event.preventDefault();
                  setQ('');
                  navigate({ ...DEFAULT_FILTERS });
                }}
                className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-sm text-foreground underline-offset-4 hover:underline sm:h-9"
              >
                <X className="size-4" aria-hidden="true" />
                {t('clear')}
              </Link>
            )}
          </div>
        </div>
        {!hydrated && (
          <Button type="submit" className="h-10 px-4">
            {t('apply')}
          </Button>
        )}
      </form>
    </search>
  );
}

function LoadMoreLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </>
  );
}

/** A plain link to `?page=n+1`, so it works without JavaScript. */
export function LoadMore({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      replace
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-card px-6 text-sm font-medium transition-colors hover:bg-muted"
    >
      <LoadMoreLabel>{children}</LoadMoreLabel>
    </Link>
  );
}
