import { type DealView, formatMoney, pick } from '@deals/core';
import { ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  CATEGORY_UI,
  cardNote,
  categoryName,
  dayLabel,
  deadline,
  exceptionBadges,
  instantLabel,
  priceParts,
  toLocale,
} from '@/lib/deal-view';
import { cn } from '@/lib/utils';
import { SaveButton } from './actions';
import { CouponLine, DeadlineText, DealBadges, PriceLine, ProductLogo } from './parts';

const host = (url: string) => new URL(url).host.replace(/^www\./, '');

/** Logo, name, category, website and summary. `level` is h1 on the page and h2 inside the modal. */
export function ProductHeader({
  product,
  level = 'h1',
}: {
  product: DealView['product'];
  level?: 'h1' | 'h2';
}) {
  const t = useTranslations('product');
  const locale = toLocale(useLocale());
  const Heading = level;
  const Icon = CATEGORY_UI[product.category].icon;
  return (
    <div className="flex items-start gap-4">
      <ProductLogo product={product} size="lg" />
      <div className="min-w-0 space-y-2">
        <Heading id="product-title" className="text-3xl font-semibold text-balance sm:text-4xl">
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
              {t('website')}: {host(product.website)}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        <p className="max-w-prose text-muted-foreground">{pick(product.summary, locale)}</p>
      </div>
    </div>
  );
}

/** Price, coupon, deadline and the primary call to action. */
export function DealPanel({ deal, now }: { deal: DealView; now: Date }) {
  const t = useTranslations('product');
  const td = useTranslations('deal');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const badges = exceptionBadges(deal, now);
  const note = cardNote(deal, locale);
  return (
    <section
      aria-label={t('panel')}
      className="space-y-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-xs"
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {pick(deal.event.name, locale)} · {pick(deal.plan, locale)}
        </p>
        <PriceLine parts={priceParts(deal, locale, td)} size="lg" />
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      <DealBadges badges={badges} />
      <CouponLine deal={deal} />
      <DeadlineText due={deadline(deal, now, td, fmt)} />
      <a
        href={deal.merchantUrl}
        target="_blank"
        rel="noopener"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t('visit')}
        <ExternalLink className="size-4" aria-hidden="true" />
      </a>
      <SaveButton
        variant="full"
        slug={deal.product.slug}
        name={deal.product.name}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{t('checkoutNote')}</p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm/relaxed">{children}</dd>
    </div>
  );
}

/** Detail rows: terms, eligibility, renewal, start and end with an honest precision label. */
export function DealFacts({ deal, now }: { deal: DealView; now: Date }) {
  const t = useTranslations('product');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());

  const bound = (at: string | null, on: string | null, unknown: React.ReactNode) => {
    if (at) {
      return (
        <>
          <span className="tabular-nums">{instantLabel(at, now, fmt, true)}</span>{' '}
          <span className="text-muted-foreground">{t('zone')}</span>
        </>
      );
    }
    if (on) {
      return (
        <>
          <span className="tabular-nums">{dayLabel(on, now, fmt, true)}</span>{' '}
          <span className="text-muted-foreground">
            · {t('dateOnly')}
            {deal.dateZone ? ` (${deal.dateZone})` : ''}
          </span>
        </>
      );
    }
    return unknown;
  };

  const started = bound(
    deal.startsAt,
    deal.startsOn,
    <span className="text-muted-foreground">
      {t('unannounced')}
      {deal.observedLiveOn
        ? ` · ${t('observedLive', { date: dayLabel(deal.observedLiveOn, now, fmt, true) })}`
        : ''}
    </span>,
  );
  const ends = bound(
    deal.endsAt,
    deal.endsOn,
    <span className="text-muted-foreground">{t('unannounced')}</span>,
  );

  return (
    <dl className="divide-y">
      <Fact label={t('plan')}>{pick(deal.plan, locale)}</Fact>
      <Fact label={t('terms')}>{pick(deal.terms, locale)}</Fact>
      {deal.eligibility && <Fact label={t('eligibility')}>{pick(deal.eligibility, locale)}</Fact>}
      {deal.existingUsers && <Fact label={t('existingUsers')}>{t('yes')}</Fact>}
      {deal.renewal && <Fact label={t('renewal')}>{pick(deal.renewal, locale)}</Fact>}
      <Fact label={t('starts')}>{started}</Fact>
      <Fact label={t('ends')}>{ends}</Fact>
    </dl>
  );
}

/** Where the deal comes from and when it was last checked. */
export function DealSources({ deal, now }: { deal: DealView; now: Date }) {
  const t = useTranslations('product');
  // Chinese sentences join without a space after the full stop.
  const gap = useLocale() === 'zh' ? '' : ' ';
  const fmt = useFormatter();
  const checked = dayLabel(deal.checkedOn, now, fmt, true);
  return (
    <section aria-labelledby="sources-title" className="space-y-3">
      <h2 id="sources-title" className="text-lg font-semibold">
        {t('sources')}
      </h2>
      <ul className="space-y-2 text-sm">
        {deal.sourceUrl && (
          <li>
            <a
              href={deal.sourceUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-8 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
            >
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('communitySource')}
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </a>
            <span className="ml-1 text-muted-foreground">{host(deal.sourceUrl)}</span>
          </li>
        )}
        {deal.verified && (
          <li>
            <a
              href={deal.merchantUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-8 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
            >
              <ShieldCheck className="size-4 text-live-foreground" aria-hidden="true" />
              {t('merchantSource')}
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </a>
            <span className="ml-1 text-muted-foreground">{host(deal.merchantUrl)}</span>
          </li>
        )}
      </ul>
      <p className="text-sm text-muted-foreground">
        {deal.verified ? t('verifiedNote') : t('communityNote')}
        {gap}
        {t('checkedOn', { date: checked })}
      </p>
    </section>
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
                <span className="font-medium">{pick(deal.event.name, locale)}</span>
                {deal.id === currentId && (
                  <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {t('current')}
                  </span>
                )}
                <span className="block text-muted-foreground">{pick(deal.plan, locale)}</span>
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                <span className="font-medium">{price.price ?? price.discount}</span>
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
  at: Date;
  amount: number;
}

/** Price observations as an inline SVG sparkline; nothing when there are no observations. */
export function PriceHistory({ points, currency }: { points: PricePoint[]; currency: string }) {
  const t = useTranslations('product');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const last = points.at(-1);
  if (!last) return null;
  const money = (n: number) => formatMoney(n, currency, locale);
  const day = (d: Date) => fmt.dateTime(d, { month: 'short', day: 'numeric' });

  const amounts = points.map((p) => p.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const t0 = points[0]?.at.getTime() ?? 0;
  const span = last.at.getTime() - t0 || 1;
  const W = 320;
  const H = 72;
  const pad = 6;
  const x = (p: PricePoint) => pad + ((p.at.getTime() - t0) / span) * (W - pad * 2);
  const y = (p: PricePoint) =>
    max === min ? H / 2 : pad + (1 - (p.amount - min) / (max - min)) * (H - pad * 2);
  const line = points.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const first = points[0];

  return (
    <section aria-labelledby="price-history-title" className="space-y-3">
      <h2 id="price-history-title" className="text-lg font-semibold">
        {t('priceHistory')}
      </h2>
      <div className="rounded-xl border bg-card p-4">
        {points.length > 1 && first ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={t('priceHistoryLabel', {
                from: money(first.amount),
                to: money(last.amount),
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
            </svg>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{day(first.at)}</span>
              <span>{day(last.at)}</span>
            </div>
          </>
        ) : null}
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
      </div>
    </section>
  );
}
