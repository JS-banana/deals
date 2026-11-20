import { type DealEvent, type DealView, pick } from '@deals/core';
import { Infinity as InfinityIcon, Search, Sparkles, Star, UserCheck } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { CouponLine, DeadlineText, PriceLine, ProductLogo } from '@/components/deals/parts';
import { EventDates } from '@/components/events/event-parts';
import { Link } from '@/i18n/navigation';
import {
  cardNote,
  categoryName,
  deadline,
  eventPhase,
  priceParts,
  toLocale,
} from '@/lib/deal-view';
import { localePath } from '@/lib/seo';

const QUICK_LINKS = [
  { href: '/?category=ai#results', key: 'ai', icon: Sparkles },
  { href: '/?lifetime=1#results', key: 'lifetime', icon: InfinityIcon },
  { href: '/?existing=1#results', key: 'existing', icon: UserCheck },
] as const;

/** Editor's pick: full card on desktop, a compact row on mobile (still visible, never hidden). */
function EditorPick({ deal, now }: { deal: DealView; now: Date }) {
  const t = useTranslations('hero');
  const td = useTranslations('deal');
  const fmt = useFormatter();
  const locale = toLocale(useLocale());
  const { product } = deal;
  return (
    <aside
      aria-label={t('pick')}
      className="relative space-y-3 rounded-2xl bg-card p-4 text-card-foreground shadow-lg ring-1 ring-foreground/10 has-[h2_a:focus-visible]:ring-3 has-[h2_a:focus-visible]:ring-ring"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Star className="size-3.5 fill-brand text-brand-foreground" aria-hidden="true" />
        {t('pick')}
      </p>
      <div className="flex items-center gap-3">
        <ProductLogo product={product} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base leading-snug font-semibold">
            <Link
              href={`/p/${product.slug}`}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {product.name}
            </Link>
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {categoryName(product.category, locale)} · {pick(deal.plan, locale)}
          </p>
        </div>
      </div>
      <PriceLine parts={priceParts(deal, locale, td)} />
      <p className="line-clamp-2 hidden text-sm text-muted-foreground lg:block">
        {cardNote(deal, locale, td)}
      </p>
      <div className="hidden lg:block">
        <CouponLine deal={deal} />
      </div>
      <DeadlineText due={deadline(deal, now, td, fmt)} />
    </aside>
  );
}

/**
 * Compact hero (about 360px on desktop). Driven by the featured event when there is one, otherwise
 * a generic site hero without event chrome.
 */
export function Hero({
  event,
  pickDeal,
  now,
}: {
  event: (DealEvent & { id: number }) | null;
  pickDeal: DealView | undefined;
  now: Date;
}) {
  const t = useTranslations('hero');
  const tp = useTranslations('events.phase');
  const locale = toLocale(useLocale());
  const phase = event ? eventPhase(event, now) : null;
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-hero text-hero-foreground"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_95%_0%,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)]"
      />
      <div className="relative mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:gap-12 lg:px-8 lg:py-10">
        <div className="space-y-4">
          <div className="space-y-2">
            {event && phase && event.kind === 'seasonal' && (
              <p className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground">
                <span className="size-1.5 rounded-full bg-brand-foreground" aria-hidden="true" />
                {tp(phase)}
              </p>
            )}
            <h1 id="hero-title" className="text-4xl font-semibold text-balance sm:text-5xl">
              {event ? pick(event.name, locale) : t('genericTitle')}
            </h1>
            <p className="max-w-2xl text-base text-hero-foreground/75 text-pretty">
              {event ? pick(event.tagline, locale) : t('genericText')}
            </p>
          </div>
          {event && <EventDates event={event} now={now} variant="hero" showRange={false} />}
          <search>
            <form
              action={`${localePath('/', locale)}#results`}
              method="get"
              className="flex max-w-xl gap-2"
            >
              <label htmlFor="hero-q" className="sr-only">
                {t('searchLabel')}
              </label>
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="hero-q"
                  type="search"
                  name="q"
                  enterKeyHint="search"
                  autoComplete="off"
                  placeholder={t('searchPlaceholder')}
                  className="h-12 w-full rounded-xl bg-card pr-3 pl-10 text-base text-card-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-brand/60 sm:text-sm"
                />
              </div>
              <button
                type="submit"
                className="h-12 shrink-0 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground transition-[filter] outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-brand/60"
              >
                {t('search')}
              </button>
            </form>
          </search>
          <ul className="flex flex-wrap gap-2">
            {QUICK_LINKS.map(({ href, key, icon: Icon }) => (
              <li key={key}>
                <Link
                  href={href}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-hero-foreground/10 px-4 text-sm text-hero-foreground transition-colors outline-none hover:bg-hero-foreground/20 focus-visible:ring-3 focus-visible:ring-brand/60"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`quick.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {pickDeal && <EditorPick deal={pickDeal} now={now} />}
      </div>
    </section>
  );
}
