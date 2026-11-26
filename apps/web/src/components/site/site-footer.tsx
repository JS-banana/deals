import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { toLocale } from '@/lib/deal-view';
import { feedPath } from '@/lib/seo';
import { Brand } from './brand';
import { TipForm } from './tip-form';

const REPO = 'https://github.com/JS-banana/deals';

export function SiteFooter() {
  const t = useTranslations('footer');
  const locale = useLocale();
  return (
    <footer className="mt-14 border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-7 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex flex-col gap-1.5">
          <Brand compact />
          <p className="text-sm text-muted-foreground">{t('tagline')}</p>
        </div>
        <nav
          aria-label={t('label')}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
        >
          <TipForm />
          <Link href="/events" className="hover:text-foreground">
            {t('events')}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t('privacy')}
          </Link>
          <a href={feedPath(toLocale(locale))} className="hover:text-foreground">
            RSS
          </a>
          <a href={REPO} className="hover:text-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
