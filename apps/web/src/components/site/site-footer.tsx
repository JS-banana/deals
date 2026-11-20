import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Brand } from './brand';

const REPO = 'https://github.com/JS-banana/deals';

export function SiteFooter() {
  const t = useTranslations('footer');
  const locale = useLocale();
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
        <div className="max-w-sm space-y-3">
          <Brand compact />
          <p className="text-sm text-muted-foreground">{t('tagline')}</p>
        </div>
        <nav
          aria-label={t('label')}
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"
        >
          <Link href="/about" className="hover:text-foreground">
            {t('about')}
          </Link>
          <Link href="/events" className="hover:text-foreground">
            {t('events')}
          </Link>
          <a
            href={locale === 'en' ? '/en/feed.xml' : '/feed.xml'}
            className="hover:text-foreground"
          >
            RSS
          </a>
          <a href={`${REPO}/issues`} className="hover:text-foreground">
            {t('feedback')}
          </a>
          <a href={REPO} className="hover:text-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
