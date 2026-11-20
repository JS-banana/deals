import { BadgeCheck, Download, Rocket, Sparkles, UserCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { getLang } from '@/lib/data';
import { alternatesFor } from '@/lib/seo';

// Rendered per request so canonical and hreflang URLs follow the runtime SITE_URL, like the other pages.
export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/JS-banana/deals';
const UPSTREAM = 'https://github.com/trungdq88/Awesome-Black-Friday-Cyber-Monday';

const SECTIONS = [
  'source',
  'marks',
  'prices',
  'time',
  'checkout',
  'pipeline',
  'origin',
  'privacy',
  'feedback',
] as const;
const STEPS = [
  { key: 'fetch', icon: Download },
  { key: 'draft', icon: Sparkles },
  { key: 'review', icon: UserCheck },
  { key: 'publish', icon: Rocket },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLang(), getTranslations('about')]);
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/about', locale),
  };
}

const externalLink = (href: string) => (chunks: React.ReactNode) => (
  <a
    href={href}
    target="_blank"
    rel="noopener"
    className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
  >
    {chunks}
  </a>
);

export default async function AboutPage() {
  const [t, tc] = await Promise.all([getTranslations('about'), getTranslations('common')]);
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: tc('home'), href: '/' },
            { label: t('title'), href: '/about' },
          ]}
        />
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold sm:text-4xl">{t('title')}</h1>
          <p className="text-lg text-muted-foreground text-pretty">{t('lead')}</p>
        </header>
      </div>

      {SECTIONS.map((id) => (
        <section key={id} aria-labelledby={`about-${id}`} className="space-y-3">
          <h2 id={`about-${id}`} className="text-xl font-semibold">
            {t(`${id}.title`)}
          </h2>
          {id === 'origin' && (
            <p className="text-muted-foreground">
              {t.rich('origin.body', { link: externalLink(UPSTREAM) })}
            </p>
          )}
          {id === 'feedback' && (
            <p className="text-muted-foreground">
              {t.rich('feedback.body', { link: externalLink(`${REPO}/issues`) })}
            </p>
          )}
          {id !== 'origin' && id !== 'feedback' && (
            <p className="text-muted-foreground">{t(`${id}.body`)}</p>
          )}
          {id === 'marks' && (
            <ul className="grid gap-3 sm:grid-cols-2">
              <li className="space-y-2 rounded-xl border bg-card p-4">
                <p className="flex items-center gap-2 font-medium">
                  <BadgeCheck className="size-4 text-live-foreground" aria-hidden="true" />
                  {t('marks.verified')}
                </p>
                <p className="text-sm text-muted-foreground">{t('marks.verifiedBody')}</p>
              </li>
              <li className="space-y-2 rounded-xl border bg-card p-4">
                <p>
                  <Badge variant="outline" className="text-muted-foreground">
                    <Users aria-hidden="true" />
                    {t('marks.community')}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">{t('marks.communityBody')}</p>
              </li>
            </ul>
          )}
          {id === 'pipeline' && (
            <ol className="grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ key, icon: Icon }, index) => (
                <li key={key} className="flex gap-3 rounded-xl border bg-card p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="space-y-0.5">
                    <span className="block font-medium">
                      <span className="mr-1.5 text-muted-foreground tabular-nums">
                        {index + 1}.
                      </span>
                      {t(`steps.${key}.title`)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t(`steps.${key}.text`)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}
