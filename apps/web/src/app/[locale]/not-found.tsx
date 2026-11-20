import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <Compass className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground tabular-nums">404</p>
        <h1 className="text-3xl font-semibold text-balance">{t('title')}</h1>
        <p className="text-muted-foreground">{t('text')}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/85"
        >
          {t('home')}
        </Link>
        <Link
          href="/events"
          className="inline-flex h-11 items-center rounded-xl border bg-card px-5 text-sm font-medium hover:bg-muted"
        >
          {t('events')}
        </Link>
      </div>
    </div>
  );
}
