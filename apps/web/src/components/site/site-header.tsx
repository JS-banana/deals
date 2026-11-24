import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Brand } from './brand';
import { CommandSearch } from './command-search';
import { LocaleSwitch } from './locale-switch';
import { SavedLink } from './saved-link';
import { ThemeToggle } from './theme-toggle';

export async function SiteHeader() {
  // The language switch includes the request's query in its server-rendered href.
  await connection();
  const t = await getTranslations('nav');
  return (
    <>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skip')}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-2 min-[360px]:px-4 sm:gap-6 sm:px-6 lg:px-8">
          <Brand />
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <CommandSearch />
            <SavedLink />
            <LocaleSwitch />
            <ThemeToggle />
          </div>
        </div>
      </header>
    </>
  );
}
