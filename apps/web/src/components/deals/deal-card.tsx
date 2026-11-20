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
import { CouponLine, DeadlineText, DealBadges, PriceLine, ProductLogo } from './parts';

/**
 * The listing card. The product name is a stretched link (opens the deal modal or page); the copy
 * button, compare checkbox and save toggle sit above it with `relative z-10`.
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
        'relative flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-md has-[h3_a:focus-visible]:ring-3 has-[h3_a:focus-visible]:ring-ring/50',
        badges.ended && 'bg-muted/40',
      )}
    >
      <header className="flex items-start gap-3">
        <ProductLogo product={product} />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate text-base leading-snug font-semibold">
            <Link
              href={`/p/${product.slug}`}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {product.name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {categoryName(product.category, locale)} · {pick(deal.plan, locale)}
          </p>
          <DealBadges badges={badges} />
        </div>
      </header>

      <p className="truncate text-sm text-muted-foreground">{pick(product.summary, locale)}</p>

      <div className="space-y-1.5">
        <PriceLine parts={price} />
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {cardNote(deal, locale, t)}
        </p>
      </div>

      <CouponLine deal={deal} className="mt-auto" />

      <footer className="flex items-center justify-between gap-2 border-t pt-2">
        <DeadlineText due={due} />
        <div className="-mr-2 flex shrink-0 items-center">
          <CompareToggle row={compareRow(deal, now, locale, t, fmt)} />
          <SaveButton slug={product.slug} name={product.name} />
        </div>
      </footer>
    </article>
  );
}
