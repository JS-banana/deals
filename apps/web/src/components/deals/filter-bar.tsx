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
import { ArrowDownUp, Check, Loader2, Search, X } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHydrated } from '@/hooks/use-hydrated';
import { getPathname, Link, usePathname, useRouter } from '@/i18n/navigation';
import { toLocale } from '@/lib/deal-view';
import { cn } from '@/lib/utils';

const isDefault = (f: ListFilters, fixed?: CategorySlug) =>
  (Boolean(fixed) || f.category === DEFAULT_FILTERS.category) &&
  f.status === DEFAULT_FILTERS.status &&
  !f.q.trim() &&
  !f.existing &&
  !f.lifetime &&
  f.sort === DEFAULT_FILTERS.sort;

/** A checkbox/radio drawn as a pill or tab. The native input keeps it working without JS. */
function Chip({
  type,
  name,
  value,
  checked,
  onChange,
  variant = 'default',
  children,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  variant?: 'default' | 'compact';
  children: ReactNode;
}) {
  const compact = variant === 'compact';
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
      <span
        className={
          type === 'radio'
            ? compact
              ? 'inline-flex h-9 items-center rounded-full px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground peer-checked:bg-primary peer-checked:font-medium peer-checked:text-primary-foreground peer-checked:shadow-xs peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50'
              : 'relative inline-flex h-10 items-center px-0.5 text-sm whitespace-nowrap text-muted-foreground transition-colors select-none hover:text-foreground peer-checked:font-semibold peer-checked:text-foreground peer-focus-visible:rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors peer-checked:after:bg-primary'
            : cn(
                'inline-flex items-center gap-1.5 bg-muted/75 text-sm whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground peer-checked:bg-primary peer-checked:font-medium peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
                compact ? 'h-9 rounded-lg px-3' : 'h-10 rounded-xl px-3.5',
              )
        }
      >
        {type === 'checkbox' && checked && (
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
        )}
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
  hideSearch = false,
  total,
}: {
  filters: ListFilters;
  /** Set on category pages: the category is part of the path, so its chips are hidden. */
  fixedCategory?: CategorySlug;
  /** True on the homepage where the Hero provides the primary search bar. */
  hideSearch?: boolean;
  total: number;
}) {
  const t = useTranslations('discover');
  const locale = toLocale(useLocale());
  const router = useRouter();
  const pathname = usePathname();
  const formAction = getPathname({ href: pathname, locale });
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
  // Follow the URL when it changes from outside (HeroSearch, back button, "clear filters").
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

  const dirty = !isDefault(view, fixedCategory);

  const resultControls = (
    <>
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
      {dirty && (
        <Link
          href={pathname}
          scroll={false}
          onClick={(event) => {
            event.preventDefault();
            window.clearTimeout(timer.current);
            setQ('');
            navigate({ ...DEFAULT_FILTERS });
          }}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-foreground underline-offset-4 hover:underline"
        >
          <X className="size-4" aria-hidden="true" />
          {t('clear')}
        </Link>
      )}
    </>
  );

  const compactSelectClass = hideSearch
    ? 'h-9 rounded-lg border-border/80 bg-card px-3 text-sm shadow-2xs data-[size=default]:h-9 dark:bg-card dark:hover:bg-muted'
    : 'h-10 rounded-xl border-border/80 bg-card px-3.5 text-sm shadow-2xs data-[size=default]:h-10 dark:bg-card dark:hover:bg-muted';

  const filterSelectsAndToggles = (
    <div
      className={cn('flex flex-wrap items-center gap-2', hideSearch ? 'lg:ml-auto' : 'md:ml-auto')}
    >
      <Chip
        type="checkbox"
        name="lifetime"
        value="1"
        checked={view.lifetime}
        onChange={() => set({ lifetime: !view.lifetime })}
        variant={hideSearch ? 'compact' : 'default'}
      >
        {t('lifetime')}
      </Chip>
      <Chip
        type="checkbox"
        name="existing"
        value="1"
        checked={view.existing}
        onChange={() => set({ existing: !view.existing })}
        variant={hideSearch ? 'compact' : 'default'}
      >
        {t('existing')}
      </Chip>
      <span
        aria-hidden="true"
        className={cn('mx-0.5 hidden w-px bg-border sm:block', hideSearch ? 'h-4' : 'h-5')}
      />
      <Select
        items={Object.fromEntries(STATUS_FILTERS.map((s) => [s, t(`status.${s}`)]))}
        value={view.status}
        onValueChange={(value) => {
          if (value) set({ status: value as StatusFilter });
        }}
      >
        <SelectTrigger aria-label={t('statusLabel')} className={compactSelectClass}>
          <SelectValue>{t(`status.${view.status}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={Object.fromEntries(SORTS.map((s) => [s, t(`sort.${s}`)]))}
        value={view.sort}
        onValueChange={(value) => {
          if (value) set({ sort: value as Sort });
        }}
      >
        <SelectTrigger aria-label={t('sortLabel')} className={compactSelectClass}>
          <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <SelectValue>{t(`sort.${view.sort}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {t(`sort.${sort}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const categoryList = (
    <fieldset
      className={cn(
        '-mx-4 min-w-0 px-4 sm:mx-0 sm:px-0',
        hideSearch ? 'w-full lg:w-auto lg:flex-1' : 'flex-1',
      )}
    >
      <legend className="sr-only">{t('categoryLabel')}</legend>
      <div
        className={
          hideSearch
            ? 'flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden'
            : '-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:gap-6 sm:overflow-visible [&::-webkit-scrollbar]:hidden'
        }
      >
        <Chip
          type="radio"
          name="category"
          value=""
          checked={view.category === null}
          onChange={() => set({ category: null })}
          variant={hideSearch ? 'compact' : 'default'}
        >
          {t('all')}
        </Chip>
        {CATEGORIES.map((category) => (
          <Chip
            key={category.slug}
            type="radio"
            name="category"
            value={category.slug}
            checked={view.category === category.slug}
            onChange={() => set({ category: category.slug })}
            variant={hideSearch ? 'compact' : 'default'}
          >
            {pick(category.name, locale)}
          </Chip>
        ))}
      </div>
    </fieldset>
  );

  return (
    <search aria-label={t('label')}>
      <form
        action={formAction}
        method="get"
        data-pending={pending}
        onSubmit={(event) => {
          event.preventDefault();
          window.clearTimeout(timer.current);
          navigate({ ...latest.current, q });
        }}
        className={hideSearch ? 'space-y-3' : 'space-y-4'}
      >
        <input type="hidden" name="status" value={view.status} />
        <input type="hidden" name="sort" value={view.sort} />
        {hideSearch && q.trim() && <input type="hidden" name="q" value={q} />}

        {hideSearch ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              {!fixedCategory && categoryList}
              {filterSelectsAndToggles}
            </div>
            {(dirty || pending) && (
              <div className="flex items-center justify-between gap-2">{resultControls}</div>
            )}
          </>
        ) : (
          <>
            {!fixedCategory && (
              <div className="flex items-center justify-between gap-4 border-b border-border">
                {categoryList}
                <div className="hidden shrink-0 items-center gap-2 pb-1 sm:flex">
                  {resultControls}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full md:min-w-56 md:max-w-md md:flex-1 lg:max-w-lg">
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
                  className="h-10 rounded-xl border-border/80 bg-card pl-10 text-sm shadow-2xs dark:bg-card"
                />
              </div>
              {filterSelectsAndToggles}
              <div
                className={
                  fixedCategory
                    ? 'ml-auto flex items-center gap-2'
                    : 'ml-auto flex items-center gap-2 sm:hidden'
                }
              >
                {resultControls}
              </div>
            </div>
          </>
        )}

        {!hydrated && (
          <Button type="submit" className="h-10 px-4">
            {t('apply')}
          </Button>
        )}
      </form>
    </search>
  );
}

function LoadMoreLabel({ children, busy }: { children: ReactNode; busy: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {(pending || busy) && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </>
  );
}

/**
 * Loads the next page automatically when the button scrolls near the viewport (infinite scroll).
 * It stays a plain link to `?page=n+1`, so it still works without JavaScript or as a manual click.
 */
export function LoadMore({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || busy) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        startTransition(() => router.replace(href, { scroll: false }));
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [href, busy, router]);
  return (
    <div ref={sentinel}>
      <Link
        href={href}
        scroll={false}
        replace
        aria-busy={busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-card px-6 text-sm font-medium transition-colors hover:bg-muted"
      >
        <LoadMoreLabel busy={busy}>{children}</LoadMoreLabel>
      </Link>
    </div>
  );
}
