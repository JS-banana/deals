import { type DealView, pick } from '@deals/core';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  cardNote,
  categoryName,
  compareRow,
  deadline,
  exceptionBadges,
  priceParts,
  toLocale,
} from '@/lib/deal-view';
import { cn } from '@/lib/utils';
import { CompareToggle, NoteHint, SaveButton } from './actions';
import { CouponChip, DeadlineText, DealBadges, PriceLine, ProductLogo } from './parts';

/**
 * The listing card, top to bottom: the product (name, category, two-line summary), then the offer
 * (plan label over the price), then the actions bar (deadline and coupon). The offer is pushed to the
 * bottom so prices line up across a grid row, and exception badges hang over the top border instead
 * of taking a row. The product name is a stretched link (opens the deal modal or page); the
 * interactive bits sit above it with `relative z-10`.
 */
export function DealCard({ deal, now }: { deal: DealView; now: Date }) {
  const locale = toLocale(useLocale());
  const t = useTranslations('deal');
  const fmt = useFormatter();
  const { product } = deal;
  const badges = exceptionBadges(deal, now);
  const note = cardNote(deal, locale);

  return (
    <article
      className={cn(
        '@container relative flex h-full flex-col rounded-2xl border bg-card p-4 text-card-foreground shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-md has-[h3_a:focus-visible]:ring-3 has-[h3_a:focus-visible]:ring-ring/50',
        badges.ended && 'bg-muted/40',
      )}
    >
      <DealBadges badges={badges} className="absolute -top-2.5 left-4 flex-nowrap" />

      <header className="flex items-start gap-3">
        <ProductLogo product={product} size="card" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate leading-snug font-semibold">
            <Link
              href={`/p/${product.slug}`}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {product.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {categoryName(product.category, locale)}
          </p>
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0">
          <CompareToggle row={compareRow(deal, now, locale, t, fmt)} variant="icon" />
          <SaveButton slug={product.slug} name={product.name} className="size-9" />
        </div>
      </header>
      <p className="mt-2.5 line-clamp-2 text-sm text-muted-foreground">
        {pick(product.summary, locale)}
      </p>

      <div className="mt-auto pt-3">
        <p className="flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
          <span className="truncate">{pick(deal.plan, locale)}</span>
          {note && <NoteHint note={note} />}
        </p>
        <PriceLine parts={priceParts(deal, locale, t)} className="mt-1.5" />
      </div>

      <footer className="mt-3 flex items-center justify-between gap-3 border-t border-dashed pt-3">
        <DeadlineText due={deadline(deal, now, t, fmt)} className="text-xs" compact />
        <CouponChip deal={deal} />
      </footer>
    </article>
  );
}
