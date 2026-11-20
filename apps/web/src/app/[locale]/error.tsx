'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-soon text-soon-foreground">
        <TriangleAlert className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-balance">{t('title')}</h1>
        <p className="text-muted-foreground">{t('text')}</p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">
            {t('reference')}: {error.digest}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={reset} className="h-11 rounded-xl px-5 text-sm">
          {t('retry')}
        </Button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl border bg-card px-5 text-sm font-medium hover:bg-muted"
        >
          {t('home')}
        </Link>
      </div>
    </div>
  );
}
