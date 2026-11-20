import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Brand } from './brand';
import { LocaleSwitch } from './locale-switch';
import { MobileNav } from './mobile-nav';
import { NAV_ITEMS } from './nav-items';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  const t = useTranslations('nav');
  return (
    <>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skip')}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Brand />
          <nav aria-label={t('label')} className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/saved"
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Bookmark className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('saved')}</span>
            </Link>
            <div className="hidden items-center gap-1 md:flex">
              <LocaleSwitch />
              <ThemeToggle />
            </div>
            <MobileNav />
          </div>
        </div>
      </header>
    </>
  );
}
