import {
  CATEGORIES,
  type CategorySlug,
  calendarDay,
  type DealEvent,
  type DealView,
  dealState,
  effectiveDiscountPercent,
  formatMoney,
  isEndingSoon,
  type Locale,
  moneyParts,
  pick,
  SITE_TIME_ZONE,
} from '@deals/core';
import { Cloud, Code, ListChecks, type LucideIcon, Palette, Sparkles, Wrench } from 'lucide-react';

/*
 * Presentation helpers shared by server components, route handlers (feed) and client stores.
 * They take a translator and formatter instead of calling hooks, so they work anywhere.
 */

export type T = (key: string, values?: Record<string, string | number>) => string;
export interface Fmt {
  dateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const toLocale = (value: string): Locale => (value === 'en' ? 'en' : 'zh');

/** Icon and soft tile colors per category, so cards in different categories look different. */
export const CATEGORY_UI: Record<CategorySlug, { icon: LucideIcon; tint: string }> = {
  ai: { icon: Sparkles, tint: 'bg-tint-violet text-tint-violet-foreground' },
  design: { icon: Palette, tint: 'bg-tint-violet text-tint-violet-foreground' },
  productivity: { icon: ListChecks, tint: 'bg-tint-blue text-tint-blue-foreground' },
  cloud: { icon: Cloud, tint: 'bg-tint-blue text-tint-blue-foreground' },
  utilities: { icon: Wrench, tint: 'bg-tint-orange text-tint-orange-foreground' },
  developer: { icon: Code, tint: 'bg-tint-green text-tint-green-foreground' },
};

export function categoryName(slug: CategorySlug, locale: Locale): string {
  return pick(CATEGORIES.find((c) => c.slug === slug)?.name, locale);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const zoneOf = (d: Pick<DealView, 'dateZone'>) => d.dateZone ?? SITE_TIME_ZONE;

/** Date-only values print the same everywhere, so they are formatted as UTC calendar days. */
export function dayLabel(day: string, now: Date, fmt: Fmt, withYear = false): string {
  const sameYear = day.slice(0, 4) === calendarDay(now).slice(0, 4);
  return fmt.dateTime(new Date(`${day}T00:00:00Z`), {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
  });
}

/** Precise instants print in the request time zone (Beijing on the Chinese site, UTC on English). */
export function instantLabel(at: string, now: Date, fmt: Fmt, withYear = false): string {
  const sameYear = calendarDay(new Date(at)).slice(0, 4) === calendarDay(now).slice(0, 4);
  return fmt.dateTime(new Date(at), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
  });
}

type Bounds = Pick<DealView, 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt'>;

export function endLabel(d: Bounds, now: Date, fmt: Fmt): string | null {
  if (d.endsAt) return instantLabel(d.endsAt, now, fmt);
  return d.endsOn ? dayLabel(d.endsOn, now, fmt) : null;
}

export function startLabel(d: Bounds, now: Date, fmt: Fmt): string | null {
  if (d.startsAt) return instantLabel(d.startsAt, now, fmt);
  return d.startsOn ? dayLabel(d.startsOn, now, fmt) : null;
}

export interface Deadline {
  primary: string;
  secondary: string | null;
  tone: 'urgent' | 'normal' | 'muted';
}

/** Relative wording plus the matching absolute date, e.g. "11 days left · Dec 1". */
export function deadline(d: DealView, now: Date, t: T, fmt: Fmt): Deadline {
  const state = dealState(d, now);
  const today = calendarDay(now, zoneOf(d));
  if (state === 'ended') {
    return { primary: t('deadline.ended'), secondary: endLabel(d, now, fmt), tone: 'muted' };
  }
  if (state === 'upcoming') {
    let primary = t('deadline.startsToday');
    if (d.startsAt) {
      const ms = Date.parse(d.startsAt) - now.getTime();
      primary =
        ms < DAY
          ? t('deadline.startsInHours', { count: Math.max(1, Math.ceil(ms / HOUR)) })
          : t('deadline.startsIn', { count: Math.floor(ms / DAY) });
    } else if (d.startsOn) {
      const days = daysBetween(today, d.startsOn);
      if (days > 0) primary = t('deadline.startsIn', { count: days });
    }
    return { primary, secondary: startLabel(d, now, fmt), tone: 'normal' };
  }
  if (d.endsAt) {
    const ms = Date.parse(d.endsAt) - now.getTime();
    const primary =
      ms < HOUR
        ? t('deadline.endsInUnderHour')
        : ms < DAY
          ? t('deadline.endsInHours', { count: Math.ceil(ms / HOUR) })
          : t('deadline.daysLeft', { count: Math.floor(ms / DAY) });
    return {
      primary,
      secondary: instantLabel(d.endsAt, now, fmt),
      tone: ms <= 48 * HOUR ? 'urgent' : 'normal',
    };
  }
  if (d.endsOn) {
    const days = daysBetween(today, d.endsOn);
    return {
      primary: days <= 0 ? t('deadline.endsToday') : t('deadline.daysLeft', { count: days }),
      secondary: dayLabel(d.endsOn, now, fmt),
      tone: days < 2 ? 'urgent' : 'normal',
    };
  }
  return { primary: t('deadline.noEnd'), secondary: null, tone: 'muted' };
}

export interface PriceParts {
  benefit: string | null;
  estimate: string | null;
  price: string | null;
  /** The price split for display typography; null when the deal has no price. */
  priceSplit: ReturnType<typeof moneyParts> | null;
  unit: string | null;
  original: string | null;
  discount: string | null;
}

/**
 * Price, billing unit, struck-through original price and the discount chip text. The unit is dropped
 * when the plan shown beside the price already says it ("Plus 买断" next to "€29.40 买断").
 */
export function priceParts(d: DealView, locale: Locale, t: T): PriceParts {
  const money = (amount: number | null) =>
    amount !== null && d.currency ? formatMoney(amount, d.currency, locale) : null;
  let discount: string | null = null;
  if (d.discountPercent !== null) discount = t('off', { percent: d.discountPercent });
  else if (d.discountAmount !== null && money(d.discountAmount))
    discount = t('save', { amount: money(d.discountAmount) ?? '' });
  else {
    const percent = effectiveDiscountPercent(d);
    if (percent && percent > 0) discount = t('off', { percent });
  }
  const unit = d.billing === 'other' ? null : t(`billing.${d.billing}`);
  const planSaysUnit = unit && pick(d.plan, locale).toLowerCase().includes(unit.toLowerCase());
  return {
    benefit:
      d.offerType !== 'discount' && d.offerType !== 'lifetime'
        ? pick(d.benefitSummary, locale) || null
        : null,
    estimate: money(d.estimatedValue),
    price: money(d.priceAmount),
    priceSplit:
      d.priceAmount !== null && d.currency ? moneyParts(d.priceAmount, d.currency, locale) : null,
    unit: planSaysUnit ? null : unit,
    original: money(d.originalAmount),
    discount,
  };
}

/** What a shopper most needs to know besides the price, or null when the deal has no such note. */
export function cardNote(d: DealView, locale: Locale): string | null {
  return pick(d.cardNote, locale) || pick(d.renewal, locale) || pick(d.eligibility, locale) || null;
}

export const logoSrc = (logoPath: string | null) => (logoPath ? `/media/${logoPath}` : null);

export interface ExceptionBadges {
  ending: 'precise' | 'date' | null;
  upcoming: boolean;
  ended: boolean;
}

/** Badges highlight upcoming, ending-soon and ended deals. */
export function exceptionBadges(d: DealView, now: Date): ExceptionBadges {
  const state = dealState(d, now);
  return {
    ending: isEndingSoon(d, now) ? (d.endsAt ? 'precise' : 'date') : null,
    upcoming: state === 'upcoming',
    ended: state === 'ended',
  };
}

export function dealHref(slug: string, id: number) {
  return `/p/${slug}?offer=${id}`;
}

/** Explicit offer links resolve within the product. Legacy product links show its main deal. */
export function mainDeal(
  deals: readonly DealView[],
  now: Date,
  offer?: string | string[],
): DealView | undefined {
  if (offer !== undefined) return deals.find((deal) => String(deal.id) === offer);
  const ended = (d: DealView) => Number(dealState(d, now) === 'ended');
  return [...deals].sort(
    (a, b) => ended(a) - ended(b) || b.checkedOn.localeCompare(a.checkedOn) || b.id - a.id,
  )[0];
}

export { type EventPhase, eventPhase } from '@deals/core';

/** "Nov 1 – Dec 7" for seasonal events, null for evergreen ones. */
export function eventRange(
  e: Pick<DealEvent, 'startsOn' | 'endsOn'>,
  now: Date,
  fmt: Fmt,
): string | null {
  if (!e.startsOn || !e.endsOn) return null;
  return `${dayLabel(e.startsOn, now, fmt)} – ${dayLabel(e.endsOn, now, fmt)}`;
}

/** "in 7 days" / "today" / "passed" for a calendar date, from the site's calendar. */
export function relativeDay(day: string, now: Date, t: T): string {
  const diff = daysBetween(calendarDay(now), day);
  if (diff === 0) return t('today');
  return diff > 0 ? t('inDays', { count: diff }) : t('passed');
}

/** Pre-formatted strings for the comparison table; computed on the server, kept in a client store. */
export interface CompareRow {
  id: number;
  slug: string;
  locale: Locale;
  name: string;
  logoPath: string | null;
  category: CategorySlug;
  plan: string;
  price: string;
  original: string;
  discount: string;
  renewal: string;
  eligibility: string;
  code: string;
  deadline: string;
  terms: string;
}

export function compareRow(d: DealView, now: Date, locale: Locale, t: T, fmt: Fmt): CompareRow {
  const price = priceParts(d, locale, t);
  const due = deadline(d, now, t, fmt);
  const dash = '—';
  return {
    id: d.id,
    slug: d.product.slug,
    locale,
    name: d.product.name,
    logoPath: d.product.logoPath,
    category: d.product.category,
    plan: pick(d.plan, locale) || dash,
    price:
      [price.benefit, price.price && `${price.price}${price.unit ? ` ${price.unit}` : ''}`]
        .filter(Boolean)
        .join(' · ') || dash,
    original: price.original ?? dash,
    discount: price.discount ?? dash,
    renewal: pick(d.renewal, locale) || dash,
    eligibility: pick(d.eligibility, locale) || dash,
    code: d.code ?? (d.noCode ? t('code.auto') : t('code.unknown')),
    deadline: due.secondary ? `${due.primary} · ${due.secondary}` : due.primary,
    terms: pick(d.terms, locale) || dash,
  };
}
