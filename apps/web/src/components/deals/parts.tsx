import type { DealView } from '@deals/core';
import { BadgeCheck, Clock, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  CATEGORY_UI,
  type Deadline,
  type ExceptionBadges,
  logoSrc,
  type PriceParts,
} from '@/lib/deal-view';
import { cn } from '@/lib/utils';
import { CodeChip, CopyCode } from './actions';

type LogoProduct = Pick<DealView['product'], 'name' | 'category' | 'logoPath'>;

/** Downloaded logo when present, otherwise a monogram tile tinted by category. */
export function ProductLogo({
  product,
  size = 'md',
}: {
  product: LogoProduct;
  size?: 'sm' | 'card' | 'md' | 'lg';
}) {
  const src = logoSrc(product.logoPath);
  const box = {
    sm: 'size-7 rounded-md text-xs',
    card: 'size-10 rounded-lg text-base',
    md: 'size-12 rounded-xl text-lg',
    lg: 'size-16 rounded-2xl text-2xl',
  }[size];
  if (src) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden bg-logo ring-1 ring-border',
          box,
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: logos are small third-party files served by /media */}
        <img
          src={src}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          className="size-full object-contain p-1.5"
        />
      </span>
    );
  }
  const initial = Array.from(product.name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold',
        CATEGORY_UI[product.category].tint,
        box,
      )}
    >
      {initial}
    </span>
  );
}

/**
 * Price headline in shop-style typography: a large, heavy integer with the currency symbol and
 * cents set smaller, followed by the billing unit, struck-through original price and discount chip.
 * Screen readers get the plain formatted price.
 */
export function PriceLine({
  parts,
  size = 'md',
  className,
}: {
  parts: PriceParts;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const t = useTranslations('deal');
  const split = parts.priceSplit;
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      {split && parts.price ? (
        <span
          className={cn(
            'leading-none font-bold tracking-tight tabular-nums',
            size === 'lg' ? 'text-5xl' : 'text-[2rem]',
          )}
        >
          <span className="sr-only">{parts.price}</span>
          <span aria-hidden="true">
            <span className="mr-0.5 text-[0.55em] font-semibold">{split.symbol}</span>
            {split.integer}
            {split.fraction && <span className="text-[0.55em]">{split.fraction}</span>}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            'leading-none font-bold tracking-tight text-live-foreground',
            size === 'lg' ? 'text-4xl' : 'text-2xl',
          )}
        >
          {parts.discount}
        </span>
      )}
      {parts.price && parts.unit && (
        <span className="text-sm text-muted-foreground">{parts.unit}</span>
      )}
      {parts.original && (
        <s className="text-sm text-muted-foreground tabular-nums">
          <span className="sr-only">{t('originalPrice')} </span>
          {parts.original}
        </s>
      )}
      {parts.price && parts.discount && (
        <span className="inline-flex h-6 items-center self-center rounded-full bg-brand px-2.5 text-xs font-semibold text-brand-foreground">
          {parts.discount}
        </span>
      )}
    </p>
  );
}

/** Coupon code with copy, "no code needed", or "code not published". */
export function CouponLine({ deal, className }: { deal: DealView; className?: string }) {
  const t = useTranslations('deal.code');
  if (deal.code) return <CopyCode code={deal.code} className={className} />;
  const auto = deal.noCode;
  return (
    <p
      className={cn(
        'flex h-10 items-center gap-2 rounded-lg px-3 text-sm',
        auto ? 'bg-live text-live-foreground' : 'bg-muted/50 text-muted-foreground',
        className,
      )}
    >
      {auto && <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{auto ? t('auto') : t('unknown')}</span>
    </p>
  );
}

/** Compact coupon state for cards: copyable code chip, "auto-applied", or "no code yet". */
export function CouponChip({ deal }: { deal: DealView }) {
  const t = useTranslations('deal.code');
  if (deal.code) return <CodeChip code={deal.code} />;
  return (
    <span
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs',
        deal.noCode ? 'bg-live text-live-foreground' : 'text-muted-foreground',
      )}
    >
      {deal.noCode && <BadgeCheck className="size-3.5" aria-hidden="true" />}
      {deal.noCode ? t('autoShort') : t('unknownShort')}
    </span>
  );
}

/**
 * Exception-only badges: ending soon, upcoming, ended, community-sourced. Every badge has a solid
 * background so cards can hang them over their top border.
 */
export function DealBadges({ badges, className }: { badges: ExceptionBadges; className?: string }) {
  const t = useTranslations('deal.badge');
  if (!badges.ending && !badges.upcoming && !badges.ended && !badges.community) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {badges.ending && (
        <li>
          <Badge className="bg-soon text-soon-foreground">
            <Clock aria-hidden="true" />
            {badges.ending === 'precise' ? t('endingPrecise') : t('ending')}
          </Badge>
        </li>
      )}
      {badges.upcoming && (
        <li>
          <Badge className="bg-tint-blue text-tint-blue-foreground">{t('upcoming')}</Badge>
        </li>
      )}
      {badges.ended && (
        <li>
          <Badge variant="secondary" className="bg-muted text-muted-foreground">
            {t('ended')}
          </Badge>
        </li>
      )}
      {badges.community && (
        <li>
          <Badge variant="outline" className="bg-card text-muted-foreground">
            <Users aria-hidden="true" />
            {t('community')}
          </Badge>
        </li>
      )}
    </ul>
  );
}

const TONE: Record<Deadline['tone'], string> = {
  urgent: 'text-soon-foreground',
  normal: 'text-foreground',
  muted: 'text-muted-foreground',
};

/** Relative deadline with the matching absolute date. */
export function DeadlineText({
  due,
  className,
  compact = false,
}: {
  due: Deadline;
  className?: string;
  /** Inside a narrow `@container` card, drop the absolute date instead of truncating it. */
  compact?: boolean;
}) {
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 text-sm', className)}>
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn('shrink-0 font-medium tabular-nums', TONE[due.tone])}>{due.primary}</span>
      {due.secondary && (
        <span
          className={cn(
            'truncate text-muted-foreground tabular-nums',
            compact && 'hidden @[21rem]:inline',
          )}
        >
          · {due.secondary}
        </span>
      )}
    </p>
  );
}
