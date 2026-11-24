import { type DealEvent, pick } from '@deals/core';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { dayLabel, eventPhase, eventRange, relativeDay, toLocale } from '@/lib/deal-view';
import { cn } from '@/lib/utils';

type EventLike = Pick<DealEvent, 'kind' | 'startsOn' | 'endsOn' | 'keyDates'>;

const PILL = {
  hero: 'bg-hero-foreground/10 text-hero-foreground',
  card: 'bg-muted text-foreground',
} as const;

/** Key dates with a relative label computed on the server ("in 7 days", "today", "passed"). */
export function EventDates({
  event,
  now,
  variant = 'card',
  showRange = true,
}: {
  event: EventLike;
  now: Date;
  variant?: keyof typeof PILL | 'inline';
  showRange?: boolean;
}) {
  const t = useTranslations('dates');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const range = eventRange(event, now, fmt);
  const phase = eventPhase(event, now);
  if (!(range && showRange) && event.keyDates.length === 0) return null;
  if (variant === 'inline') {
    return (
      <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
        {range && showRange && <li>{range}</li>}
        {event.keyDates.map((key) => (
          <li key={key.date}>
            {pick(key.label, locale)} {dayLabel(key.date, now, fmt)}
            {phase !== 'ended' && (
              <>
                {' '}
                <span className="font-medium text-foreground">
                  · {relativeDay(key.date, now, t)}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {range && showRange && (
        <li
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm',
            PILL[variant],
          )}
        >
          <CalendarDays className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          <span className="tabular-nums">{range}</span>
        </li>
      )}
      {event.keyDates.map((key) => (
        <li
          key={key.date}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm',
            PILL[variant],
          )}
        >
          <span>{pick(key.label, locale)}</span>
          <span className="tabular-nums opacity-80">{dayLabel(key.date, now, fmt)}</span>
          {phase !== 'ended' && (
            <span className="font-medium tabular-nums">· {relativeDay(key.date, now, t)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Event card for the events index. The running event gets the hero treatment. */
export function EventCard({
  event,
  count,
  now,
  highlight = false,
}: {
  event: EventLike & Pick<DealEvent, 'slug' | 'name' | 'tagline'>;
  count: number;
  now: Date;
  highlight?: boolean;
}) {
  const t = useTranslations('events');
  const locale = toLocale(useLocale());
  const phase = eventPhase(event, now);
  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        'group/event flex h-full flex-col gap-4 rounded-2xl border p-5 transition-[border-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        highlight
          ? 'border-transparent bg-hero text-hero-foreground hover:shadow-lg'
          : 'bg-card hover:border-foreground/20 hover:shadow-md',
      )}
    >
      <span className="space-y-1.5">
        {event.kind === 'seasonal' && (
          <span
            className={cn(
              'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold',
              highlight
                ? 'bg-brand text-brand-foreground'
                : 'bg-secondary text-secondary-foreground',
            )}
          >
            {t(`phase.${phase}`)}
          </span>
        )}
        <span className="block text-xl font-semibold">{pick(event.name, locale)}</span>
        <span
          className={cn(
            'block text-sm',
            highlight ? 'text-hero-foreground/75' : 'text-muted-foreground',
          )}
        >
          {pick(event.tagline, locale)}
        </span>
      </span>
      <EventDates event={event} now={now} variant={highlight ? 'hero' : 'card'} />
      <span className="mt-auto flex items-center justify-between pt-1 text-sm">
        <span
          className={cn(
            'tabular-nums',
            highlight ? 'text-hero-foreground/75' : 'text-muted-foreground',
          )}
        >
          {t('dealCount', { count })}
        </span>
        <span className="inline-flex items-center gap-1 font-medium">
          {t('open')}
          <ArrowRight
            className="size-4 transition-transform group-hover/event:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </span>
    </Link>
  );
}

/** Compact hero for a single event page. */
export function EventHero({
  event,
  count,
  now,
}: {
  event: EventLike & Pick<DealEvent, 'name' | 'tagline'>;
  count: number;
  now: Date;
}) {
  const t = useTranslations('events');
  const locale = toLocale(useLocale());
  const phase = eventPhase(event, now);
  return (
    <section
      aria-labelledby="event-title"
      className="relative overflow-hidden rounded-3xl bg-hero text-hero-foreground"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_95%_0%,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)]"
      />
      <div className="relative space-y-4 p-6 sm:p-8">
        {event.kind === 'seasonal' && (
          <p className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground">
            {t(`phase.${phase}`)}
          </p>
        )}
        <div className="space-y-2">
          <h1 id="event-title" className="text-3xl font-semibold text-balance sm:text-4xl">
            {pick(event.name, locale)}
          </h1>
          <p className="max-w-2xl text-hero-foreground/75">{pick(event.tagline, locale)}</p>
        </div>
        <EventDates event={event} now={now} variant="hero" />
        <p className="text-sm text-hero-foreground/75 tabular-nums">{t('dealCount', { count })}</p>
      </div>
    </section>
  );
}
