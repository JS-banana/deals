import { type DealEvent, type ListFilters, pick } from '@deals/core';
import { useLocale, useTranslations } from 'next-intl';
import { EventDates } from '@/components/events/event-parts';
import { eventPhase, toLocale } from '@/lib/deal-view';
import { HeroSearch } from './hero-search';

/**
 * Centered editorial hero with a subtle micro-grid backdrop, live deal summary and primary search.
 */
export function Hero({
  event,
  filters,
  activeCount,
  now,
}: {
  event: (DealEvent & { id: number }) | null;
  filters: ListFilters;
  activeCount: number;
  now: Date;
}) {
  const t = useTranslations('hero');
  const tp = useTranslations('events.phase');
  const locale = toLocale(useLocale());
  const phase = event?.kind === 'seasonal' ? eventPhase(event, now) : null;
  const title = event ? pick(event.name, locale) : t('genericTitle');
  const subtitle = event ? pick(event.tagline, locale) : t('genericText');

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden border-b border-border/70 bg-background"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_5%,transparent)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_75%_85%_at_50%_35%,#000_55%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_65%_at_50%_0%,color-mix(in_oklch,var(--brand)_26%,transparent),transparent)] dark:bg-[radial-gradient(55%_65%_at_50%_0%,color-mix(in_oklch,var(--brand)_14%,transparent),transparent)]"
      />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-8 pb-9 text-center sm:px-6 sm:pt-11 sm:pb-11">
        {event && (phase || event.keyDates.length > 0) && (
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-2xl border border-border/80 bg-card/85 px-4 py-2 text-xs shadow-2xs backdrop-blur-xs sm:rounded-full sm:px-3.5 sm:py-1.5 sm:text-sm">
            {phase && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-live-foreground">
                <span className="size-1.5 rounded-full bg-live-foreground" aria-hidden="true" />
                {tp(phase)}
              </span>
            )}
            <EventDates event={event} now={now} variant="inline" showRange={false} />
          </div>
        )}
        <h1
          id="hero-title"
          className="mt-4 text-3xl font-bold tracking-tight text-balance text-foreground sm:text-5xl sm:leading-[1.12]"
        >
          {event?.kind === 'seasonal' ? (
            <>
              <span>{title}</span>{' '}
              <span className="bg-gradient-to-r from-primary via-live-foreground to-chart-1 bg-clip-text text-transparent dark:from-brand dark:via-live-foreground dark:to-brand">
                {t('seasonSuffix')}
              </span>
            </>
          ) : (
            title
          )}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground text-pretty sm:text-base">
          <strong className="font-semibold text-foreground tabular-nums">
            {t('subtitleCount', { count: activeCount })}
          </strong>
          {subtitle ? ` · ${subtitle}` : ''}
        </p>
        <div className="mt-6 flex w-full justify-center sm:mt-7">
          <HeroSearch filters={filters} />
        </div>
      </div>
    </section>
  );
}
