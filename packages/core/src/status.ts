import type { Deal } from './schema.ts';

/** Calendar used when a deal only publishes dates and no time zone. */
export const SITE_TIME_ZONE = 'Asia/Shanghai';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** `YYYY-MM-DD` for `now` as seen in `zone`. */
export function calendarDay(now: Date, zone: string = SITE_TIME_ZONE): string {
  let format = dayFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormats.set(zone, format);
  }
  return format.format(now);
}

type Timing = Pick<
  Deal,
  'startsOn' | 'endsOn' | 'startsAt' | 'endsAt' | 'dateZone' | 'observedLiveOn'
>;

/**
 * - `upcoming` / `ended`: outside the published window.
 * - `live`: inside the window and the start is known (published or observed on the merchant page).
 * - `unknown`: not ended, but nobody has confirmed it started. Still shown as an active deal.
 *
 * Precise instants (`startsAt`/`endsAt`) win; date-only bounds use the merchant's calendar when
 * `dateZone` is known, otherwise the site's calendar.
 */
export type DealState = 'upcoming' | 'live' | 'ended' | 'unknown';

export function dealState(d: Timing, now: Date): DealState {
  const day = calendarDay(now, d.dateZone ?? SITE_TIME_ZONE);
  const ended = d.endsAt
    ? now.getTime() >= Date.parse(d.endsAt)
    : d.endsOn !== null && day > d.endsOn;
  if (ended) return 'ended';
  const notStarted = d.startsAt
    ? now.getTime() < Date.parse(d.startsAt)
    : d.startsOn !== null && day < d.startsOn;
  if (notStarted) return 'upcoming';
  const started =
    d.startsAt !== null ||
    d.startsOn !== null ||
    (d.observedLiveOn !== null && d.observedLiveOn <= day);
  return started ? 'live' : 'unknown';
}

export const isActive = (state: DealState) => state !== 'ended';

/** Active and ending within 48 hours (precise end) or within the next two calendar days. */
export function isEndingSoon(d: Timing, now: Date): boolean {
  const state = dealState(d, now);
  if (state !== 'live' && state !== 'unknown') return false;
  if (d.endsAt) return Date.parse(d.endsAt) - now.getTime() <= 48 * HOUR;
  if (!d.endsOn) return false;
  const left = Date.parse(d.endsOn) - Date.parse(calendarDay(now, d.dateZone ?? SITE_TIME_ZONE));
  return left >= 0 && left < 2 * DAY;
}

/** Approximate end instant for sorting; date-only ends count as the end of that UTC day. */
export function endInstant(d: Pick<Deal, 'endsOn' | 'endsAt'>): number {
  if (d.endsAt) return Date.parse(d.endsAt);
  if (d.endsOn) return Date.parse(`${d.endsOn}T23:59:59Z`);
  return Number.POSITIVE_INFINITY;
}

export function startInstant(d: Pick<Deal, 'startsOn' | 'startsAt'>): number {
  if (d.startsAt) return Date.parse(d.startsAt);
  if (d.startsOn) return Date.parse(`${d.startsOn}T00:00:00Z`);
  return Number.NEGATIVE_INFINITY;
}
