import { type DealView, formatMoney, pick } from '@deals/core';
import { ExternalLink } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  CATEGORY_UI,
  cardNote,
  categoryName,
  compareRow,
  dayLabel,
  deadline,
  dealHref,
  exceptionBadges,
  instantLabel,
  priceParts,
  toLocale,
} from '@/lib/deal-view';
import { cn } from '@/lib/utils';
import { CompareToggle, SaveButton } from './actions';
import { CouponLine, DeadlineText, DealBadges, PriceLine, ProductLogo } from './parts';

const host = (url: string) => new URL(url).host.replace(/^www\./, '');

/** Logo, name, category, website and summary. `level` is h1 on the page and h2 inside the modal. */
export function ProductHeader({
  product,
  level = 'h1',
  compact = false,
}: {
  product: DealView['product'];
  level?: 'h1' | 'h2';
  compact?: boolean;
}) {
  const locale = toLocale(useLocale());
  const Heading = level;
  const Icon = CATEGORY_UI[product.category].icon;
  return (
    <div className="flex items-start gap-4">
      <ProductLogo product={product} size={compact ? 'md' : 'lg'} />
      <div className={cn('min-w-0', compact ? 'space-y-1.5' : 'space-y-2')}>
        <Heading
          id="product-title"
          className={cn(
            'font-semibold text-balance',
            compact ? 'pr-8 text-2xl' : 'text-3xl sm:text-4xl',
          )}
        >
          {product.name}
        </Heading>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Link
            href={`/category/${product.category}`}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium',
              CATEGORY_UI[product.category].tint,
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {categoryName(product.category, locale)}
          </Link>
          {product.website && (
            <a
              href={product.website}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-8 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {host(product.website)}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        <p className={cn('max-w-prose text-muted-foreground', compact && 'text-sm')}>
          {pick(product.summary, locale)}
        </p>
      </div>
    </div>
  );
}

/** Price, coupon, deadline and the primary call to action. */
export function DealPanel({
  deal,
  now,
  variant = 'page',
}: {
  deal: DealView;
  now: Date;
  variant?: 'page' | 'modal';
}) {
  const t = useTranslations('product');
  const td = useTranslations('deal');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const badges = exceptionBadges(deal, now);
  const note = cardNote(deal, locale);
  const modal = variant === 'modal';
  return (
    <section
      aria-label={t('panel')}
      className={cn(
        'rounded-2xl border text-card-foreground',
        modal ? 'space-y-3.5 bg-muted/40 p-4 sm:p-5' : 'space-y-4 bg-card p-5 shadow-xs',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {pick(deal.event.name, locale)} · {pick(deal.plan, locale)}
        </p>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <DealBadges badges={badges} />
          <DeadlineText due={deadline(deal, now, td, fmt)} className="text-xs" />
        </div>
      </div>
      <div className="space-y-2">
        <PriceLine parts={priceParts(deal, locale, td)} size="lg" />
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {(deal.code || deal.noCode) && <CouponLine deal={deal} />}
      <div
        className={
          modal
            ? 'flex flex-wrap items-center gap-2'
            : 'grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-4'
        }
      >
        <a
          href={deal.merchantUrl}
          target="_blank"
          rel="noopener"
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50',
            modal ? 'h-11 min-w-40 flex-1 px-4 text-sm' : 'col-span-2 h-12 w-full px-5 text-base',
          )}
        >
          {t('visit')}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
        <SaveButton
          variant="full"
          slug={deal.product.slug}
          dealId={deal.id}
          name={deal.product.name}
          className={modal ? 'h-11 shrink-0 rounded-xl px-3.5' : undefined}
        />
        <CompareToggle
          row={compareRow(deal, now, locale, td, fmt)}
          variant={modal ? 'button' : 'label'}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('checkoutNote')}</p>
    </section>
  );
}

/** Terms, eligibility, renewal and the published validity window. */
export function DealFacts({
  deal,
  now,
  variant = 'page',
}: {
  deal: DealView;
  now: Date;
  variant?: 'page' | 'modal';
}) {
  const t = useTranslations('product');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const modal = variant === 'modal';

  const bound = (at: string | null, on: string | null) => {
    if (at) return `${instantLabel(at, now, fmt, true)} ${t('zone')}`;
    return on ? dayLabel(on, now, fmt, true) : null;
  };
  const start = bound(deal.startsAt, deal.startsOn);
  const end = bound(deal.endsAt, deal.endsOn);
  let validity: string | null = null;
  if (start && end) validity = `${start} – ${end}`;
  else if (end) validity = t('until', { date: end });
  else if (start) validity = t('from', { date: start });

  const terms = pick(deal.terms, locale);
  const benefit = pick(deal.benefitSummary, locale);
  const howToClaim = pick(deal.howToClaim, locale);
  const notes = [
    [t('terms'), terms],
    [t('benefit'), benefit],
    [t('howToClaim'), howToClaim],
  ].filter(([, value]) => value);
  const rows = [
    [t('offerType'), deal.offerType === 'discount' ? null : t(`offerTypes.${deal.offerType}`)],
    ...(modal ? [] : notes),
    [t('validity'), validity],
    [t('eligibility'), pick(deal.eligibility, locale)],
    [t('existingUsers'), deal.existingUsers ? t('yes') : null],
    [t('renewal'), pick(deal.renewal, locale)],
  ].filter(([, value]) => value);

  return (
    <div className={modal ? 'space-y-3.5' : undefined}>
      {modal && notes.length > 0 && (
        <section className="space-y-3" aria-labelledby="offer-notes-title">
          <h3 id="offer-notes-title" className="text-sm font-medium text-foreground">
            {t('offerNotes')}
          </h3>
          {notes.map(([label, value]) => (
            <p key={label} className="text-sm/relaxed whitespace-pre-line text-muted-foreground">
              {notes.length > 1 && (
                <span className="font-medium text-foreground">
                  {label}
                  {locale === 'zh' ? '：' : ': '}
                </span>
              )}
              {value}
            </p>
          ))}
        </section>
      )}
      {rows.length > 0 && (
        <dl
          className={
            modal ? 'grid grid-cols-1 gap-x-6 gap-y-2.5 border-t pt-3.5 sm:grid-cols-2' : 'divide-y'
          }
        >
          {rows.map(([label, value]) => (
            <div
              key={label}
              className={modal ? undefined : 'grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4'}
            >
              <dt className={cn('text-muted-foreground', modal ? 'text-xs' : 'text-sm')}>
                {label}
              </dt>
              <dd
                className={
                  modal ? 'text-sm text-foreground' : 'text-sm/relaxed whitespace-pre-line'
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Every deal this product has had, across events and including ended ones. Hidden for one deal. */
export function DealHistory({
  deals,
  currentId,
  now,
}: {
  deals: readonly DealView[];
  currentId: number;
  now: Date;
}) {
  const t = useTranslations('product');
  const td = useTranslations('deal');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  if (deals.length < 2) return null;
  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <h2 id="history-title" className="text-lg font-semibold">
        {t('history')}
      </h2>
      <ul className="divide-y rounded-xl border bg-card">
        {deals.map((deal) => {
          const price = priceParts(deal, locale, td);
          const due = deadline(deal, now, td, fmt);
          return (
            <li
              key={deal.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <span className="min-w-0">
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={dealHref(deal.product.slug, deal.id)}
                >
                  {pick(deal.event.name, locale)} · {pick(deal.plan, locale)}
                </Link>
                {deal.id === currentId && (
                  <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {t('current')}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                <span className="font-medium">
                  {price.benefit ?? price.price ?? price.discount}
                </span>
                <span className="text-muted-foreground">{due.primary}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface PricePoint {
  id: number;
  at: Date;
  amount: number;
}

/** Flat prices show a monitoring summary; changing prices show each observation on the chart. */
export function PriceHistory({ points, currency }: { points: PricePoint[]; currency: string }) {
  const t = useTranslations('product');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const money = (n: number) => formatMoney(n, currency, locale);
  const day = (d: Date) => fmt.dateTime(d, { month: 'short', day: 'numeric' });

  const min = points.reduce((lowest, point) => Math.min(lowest, point.amount), first.amount);
  const max = points.reduce((highest, point) => Math.max(highest, point.amount), first.amount);
  const stable = points.length > 1 && min === max;
  const t0 = first.at.getTime();
  const span = last.at.getTime() - t0;
  const W = 320;
  const H = 72;
  const pad = 6;
  const chart =
    max > min
      ? points.map((p, index) => ({
          ...p,
          x:
            pad +
            (span ? (p.at.getTime() - t0) / span : index / (points.length - 1)) * (W - pad * 2),
          y: pad + (1 - (p.amount - min) / (max - min)) * (H - pad * 2),
        }))
      : [];
  const line = chart.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <section aria-labelledby="price-history-title" className="space-y-3">
      <h2 id="price-history-title" className="text-lg font-semibold">
        {t('priceHistory')}
      </h2>
      <div className="rounded-xl border bg-card p-4">
        {stable && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm font-medium tabular-nums">
            {t('stablePrice', { price: money(min), count: points.length })}
          </p>
        )}
        {chart.length > 0 && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={t('priceHistoryLabel', {
              min: money(min),
              max: money(max),
            })}
            className="h-20 w-full"
            preserveAspectRatio="none"
          >
            <polygon points={`${pad},${H} ${line} ${W - pad},${H}`} className="fill-primary/10" />
            <polyline
              points={line}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-primary"
            />
            {chart.map((p) => (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r="3"
                className={
                  p.amount === min
                    ? 'fill-live-foreground stroke-live-foreground'
                    : 'fill-card stroke-primary'
                }
              >
                <title>{`${day(p.at)} · ${money(p.amount)}`}</title>
              </circle>
            ))}
          </svg>
        )}
        {points.length > 1 && (
          <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
            <time dateTime={first.at.toISOString()}>{day(first.at)}</time>
            <time dateTime={last.at.toISOString()}>{day(last.at)}</time>
          </div>
        )}
        {!stable && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
            <span>
              {t('latest')}: <b className="font-medium text-foreground">{money(last.amount)}</b>
              {points.length === 1 && ` · ${day(last.at)}`}
            </span>
            {points.length > 1 && (
              <>
                <span>
                  {t('lowest')}: <b className="font-medium text-foreground">{money(min)}</b>
                </span>
                <span>
                  {t('highest')}: <b className="font-medium text-foreground">{money(max)}</b>
                </span>
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
