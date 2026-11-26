import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getLang } from '@/lib/data';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLang(), getTranslations('privacy')]);
  return { title: t('title'), alternates: alternatesFor('/privacy', locale) };
}

export default async function PrivacyPage() {
  const t = await getTranslations();
  return (
    <article className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold">{t('privacy.title')}</h1>
      <p className="text-muted-foreground">{t('privacy.analytics')}</p>
      <ul className="space-y-2">
        <li>
          <a
            className="underline underline-offset-4"
            href="https://policies.google.com/technologies/partner-sites"
          >
            {t('privacy.google')}
          </a>
        </li>
        <li>
          <a
            className="underline underline-offset-4"
            href="https://tools.google.com/dlpage/gaoptout"
          >
            {t('privacy.optOut')}
          </a>
        </li>
      </ul>
      <p className="text-muted-foreground">{t('about.privacy.body')}</p>
    </article>
  );
}
