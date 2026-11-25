'use client';

import { DEFAULT_FILTERS, filtersToParams, type ListFilters } from '@deals/core';
import { Loader2, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, useEffect, useRef, useState, useTransition } from 'react';
import { getPathname, usePathname, useRouter } from '@/i18n/navigation';
import { toLocale } from '@/lib/deal-view';

/**
 * Hero search bar synced with URL `?q=` while preserving active filters.
 * Submits as a plain GET form without JavaScript and debounces live updates with JS.
 */
export function HeroSearch({ filters }: { filters: ListFilters }) {
  const t = useTranslations('hero');
  const td = useTranslations('discover');
  const locale = toLocale(useLocale());
  const router = useRouter();
  const pathname = usePathname();
  const formAction = getPathname({ href: pathname, locale });
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  const latestFilters = useRef(filters);
  const sentQ = useRef(filters.q);
  const timer = useRef<number | undefined>(undefined);
  const composing = useRef(false);

  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!pending && filters.q !== sentQ.current) {
      sentQ.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q, pending]);

  function navigate(nextQ: string) {
    const next = { ...latestFilters.current, q: nextQ };
    const query = filtersToParams(next).toString();
    sentQ.current = nextQ.trim();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function onQuery(value: string) {
    setQ(value);
    window.clearTimeout(timer.current);
    if (composing.current) return;
    timer.current = window.setTimeout(() => navigate(value), 300);
  }

  function clear() {
    window.clearTimeout(timer.current);
    setQ('');
    navigate('');
  }

  return (
    <form
      action={formAction}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        window.clearTimeout(timer.current);
        navigate(q);
      }}
      className="w-full max-w-2xl"
    >
      {filters.category && <input type="hidden" name="category" value={filters.category} />}
      {filters.status !== DEFAULT_FILTERS.status && (
        <input type="hidden" name="status" value={filters.status} />
      )}
      {filters.lifetime && <input type="hidden" name="lifetime" value="1" />}
      {filters.existing && <input type="hidden" name="existing" value="1" />}
      {filters.sort !== DEFAULT_FILTERS.sort && (
        <input type="hidden" name="sort" value={filters.sort} />
      )}
      <div className="relative flex items-center rounded-2xl border border-border bg-card p-1.5 shadow-[0_10px_30px_-12px_color-mix(in_oklch,var(--foreground)_12%,transparent)] ring-1 ring-foreground/[0.03] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
        <label htmlFor="hero-q" className="sr-only">
          {td('searchLabel')}
        </label>
        <Search
          className="pointer-events-none ml-3 size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id="hero-q"
          type="search"
          name="q"
          value={q}
          enterKeyHint="search"
          autoComplete="off"
          placeholder={td('searchPlaceholder')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            onQuery(event.currentTarget.value);
          }}
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
        />
        {q.length > 0 && (
          <button
            type="button"
            onClick={clear}
            aria-label={t('clearSearch')}
            className="mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <span>{t('searchButton')}</span>
          <Search className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
