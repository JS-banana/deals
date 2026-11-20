'use client';

import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSaved } from '@/hooks/use-saved';
import { Link } from '@/i18n/navigation';

/** Header link to the saved page with a live count (synced across tabs). */
export function SavedLink() {
  const t = useTranslations('nav');
  const count = useSaved().length;
  return (
    <Link
      href="/saved"
      aria-label={count > 0 ? t('savedCount', { count }) : t('saved')}
      className="relative inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3"
    >
      <Bookmark className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">{t('saved')}</span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums sm:static sm:h-5 sm:min-w-5 sm:text-xs"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
