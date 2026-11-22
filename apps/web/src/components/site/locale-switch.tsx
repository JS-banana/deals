'use client';

import { Languages } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { getPathname, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Link directly to the other language and carry over the current filters. */
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const t = useTranslations('nav');
  const next = locale === 'zh' ? 'en' : 'zh';
  const path = getPathname({ href: pathname, locale: next });
  return (
    <a
      href={search ? `${path}?${search}` : path}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      aria-label={t('switchLanguage')}
      hrefLang={next === 'zh' ? 'zh-CN' : 'en'}
    >
      <Languages className="size-4" aria-hidden="true" />
      <span>{next === 'zh' ? '中文' : 'EN'}</span>
    </a>
  );
}
