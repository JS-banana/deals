import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <rect width="36" height="36" rx="9" className="fill-primary dark:fill-card" />
      <path className="fill-brand" d="M9 10h5.5v5.5H9zm10 0h5.5v5.5H19zM9 20h5.5v5.5H9z" />
      <path
        d="m19 22 2.4 2.4 5-5.6"
        fill="none"
        className="stroke-brand"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('meta');
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={t('home')}>
      <BrandMark className={compact ? 'size-7' : 'size-9'} />
      <span className="flex flex-col leading-none">
        <span className={compact ? 'font-semibold' : 'text-lg font-semibold'}>{t('siteName')}</span>
        <span className="mt-1 text-[0.6rem] font-semibold tracking-[0.22em] text-muted-foreground">
          DEAL INDEX
        </span>
      </span>
    </Link>
  );
}
