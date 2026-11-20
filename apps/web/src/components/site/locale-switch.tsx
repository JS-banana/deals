'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Switches language while keeping the current path and query. */
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  // Read the query after hydration so static pages need no Suspense boundary for useSearchParams.
  const [search, setSearch] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the query whenever the route changes
  useEffect(() => setSearch(window.location.search.slice(1)), [pathname]);
  const t = useTranslations('nav');
  const next = locale === 'zh' ? 'en' : 'zh';
  return (
    <Link
      href={search ? `${pathname}?${search}` : pathname}
      locale={next}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      aria-label={t('switchLanguage')}
      hrefLang={next === 'zh' ? 'zh-CN' : 'en'}
    >
      <Languages className="size-4" aria-hidden="true" />
      <span>{next === 'zh' ? '中文' : 'EN'}</span>
    </Link>
  );
}
