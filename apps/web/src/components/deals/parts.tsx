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
import { CopyCode } from './actions';

type LogoProduct = Pick<DealView['product'], 'name' | 'category' | 'logoPath'>;

/** Downloaded logo when present, otherwise a monogram tile tinted by category. */
export function ProductLogo({
  product,
  size = 'md',
}: {
  product: LogoProduct;
  size?: 'sm' | 'md' | 'lg';
}) {
  const src = logoSrc(product.logoPath);
  const box = {
    sm: 'size-7 rounded-md text-xs',
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

/** Price headline, billing unit, struck-through original price and discount chip. */
export function PriceLine({ parts, size = 'md' }: { parts: PriceParts; size?: 'md' | 'lg' }) {
  const t = useTranslations('deal');
  const headline = parts.price ?? parts.discount;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        className={cn(
          'font-semibold tabular-nums',
          size === 'lg' ? 'text-4xl' : 'text-2xl',
          !parts.price && 'text-live-foreground',
        )}
      >
        {headline}
      </span>
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
        <span className="inline-flex h-6 items-center rounded-full bg-brand px-2.5 text-xs font-semibold text-brand-foreground">
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

/** Exception-only badges: ending soon, upcoming, ended, community-sourced. */
export function DealBadges({ badges }: { badges: ExceptionBadges }) {
  const t = useTranslations('deal.badge');
  if (!badges.ending && !badges.upcoming && !badges.ended && !badges.community) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
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
          <Badge variant="outline" className="text-muted-foreground">
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
export function DeadlineText({ due, className }: { due: Deadline; className?: string }) {
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 text-sm', className)}>
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn('shrink-0 font-medium tabular-nums', TONE[due.tone])}>{due.primary}</span>
      {due.secondary && (
        <span className="truncate text-muted-foreground tabular-nums">· {due.secondary}</span>
      )}
    </p>
  );
}
