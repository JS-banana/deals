import { dealState, parseFilters } from '@deals/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Discovery, parsePage } from '@/components/deals/discovery';
import { Hero } from '@/components/home/hero';
import { TopicsSection } from '@/components/home/topics-section';
import { getEvents, getLang, getNow, getPublishedDeals } from '@/lib/data';
import { eventPhase } from '@/lib/deal-view';
import { alternatesFor, JsonLd, pageUrl } from '@/lib/seo';

const FILTER_KEYS = ['category', 'status', 'q', 'existing', 'lifetime', 'sort', 'page'];

export async function generateMetadata(props: PageProps<'/[locale]'>): Promise<Metadata> {
  const [locale, params] = await Promise.all([getLang(), props.searchParams]);
  // Filtered views are shareable but should not compete with the main page in search results.
  const filtered = FILTER_KEYS.some((key) => key in params);
  return {
    alternates: alternatesFor('/', locale),
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function HomePage(props: PageProps<'/[locale]'>) {
  const [params, deals, events, locale, t] = await Promise.all([
    props.searchParams,
    getPublishedDeals(),
    getEvents(),
    getLang(),
    getTranslations(),
  ]);
  const now = getNow();
  const featured = events.find((e) => e.featured && eventPhase(e, now) !== 'ended') ?? null;
  const pickDeal = (featured ? deals.filter((d) => d.event.slug === featured.slug) : deals).find(
    (d) => dealState(d, now) !== 'ended',
  );
  const home = pageUrl('/', locale);

  return (
    <>
      <Hero event={featured} pickDeal={pickDeal} now={now} />
      <section
        aria-labelledby="deals-title"
        className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8"
      >
        <h2 id="deals-title" className="mb-5 text-2xl font-semibold">
          {t('discover.title')}
        </h2>
        <Discovery
          deals={deals}
          filters={parseFilters(params)}
          page={parsePage(params.page)}
          basePath="/"
          now={now}
        />
      </section>
      <TopicsSection deals={deals} now={now} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: t('meta.siteName'),
          url: home,
          inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${home}?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        }}
      />
    </>
  );
}
