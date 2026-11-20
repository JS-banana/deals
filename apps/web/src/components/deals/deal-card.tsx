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
import { CompareToggle, SaveButton } from './actions';
import { CouponChip, DeadlineText, DealBadges, PriceLine, ProductLogo } from './parts';

/**
 * The listing card, kept to six short rows so a desktop screen shows two rows of four.
 * The product name is a stretched link (opens the deal modal or page); compare, save and the
 * coupon chip sit above it with `relative z-10`.
 */
export function DealCard({ deal, now }: { deal: DealView; now: Date }) {
  const locale = toLocale(useLocale());
  const t = useTranslations('deal');
  const fmt = useFormatter();
  const { product } = deal;
  const price = priceParts(deal, locale, t);
  const badges = exceptionBadges(deal, now);
  const due = deadline(deal, now, t, fmt);

  return (
    <article
      className={cn(
        '@container relative flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 text-card-foreground shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-md has-[h3_a:focus-visible]:ring-3 has-[h3_a:focus-visible]:ring-ring/50',
        badges.ended && 'bg-muted/40',
      )}
    >
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
            {categoryName(product.category, locale)} · {pick(deal.plan, locale)}
          </p>
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0">
          <CompareToggle row={compareRow(deal, now, locale, t, fmt)} variant="icon" />
          <SaveButton slug={product.slug} name={product.name} className="size-9" />
        </div>
      </header>

      <DealBadges badges={badges} />
      <p className="truncate text-sm text-muted-foreground">{pick(product.summary, locale)}</p>
      <PriceLine parts={price} />
      <p className="truncate text-sm text-muted-foreground">{cardNote(deal, locale, t)}</p>

      <footer className="mt-auto flex items-center justify-between gap-3 pt-1">
        <DeadlineText due={due} className="text-xs" compact />
        <CouponChip deal={deal} />
      </footer>
    </article>
  );
}
