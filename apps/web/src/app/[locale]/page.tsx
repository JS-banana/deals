import { type DealEvent, dealState, parseFilters, pick } from '@deals/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Discovery, parsePage } from '@/components/deals/discovery';
import { Hero } from '@/components/home/hero';
import { getEvents, getLang, getNow, getPublishedDeals } from '@/lib/data';
import { eventPhase } from '@/lib/deal-view';
import { alternatesFor, JsonLd, pageUrl } from '@/lib/seo';

/**
 * Filtered views get noindex. `page` is not a filter: infinite scroll rewrites the URL to `?page=2`
 * as soon as the list end is near, which in Google's tall render viewport happens on load, and a
 * noindex there would drop the home page itself. Paged URLs already canonicalize to `/`.
 */
const FILTER_KEYS = ['category', 'status', 'q', 'existing', 'lifetime', 'sort'];

/** The featured event that has not ended drives the hero and, when seasonal, the page title. */
const featuredEvent = <E extends Pick<DealEvent, 'featured' | 'kind' | 'startsOn' | 'endsOn'>>(
  events: E[],
  now: Date,
) => events.find((e) => e.featured && eventPhase(e, now) !== 'ended') ?? null;

export async function generateMetadata(props: PageProps<'/[locale]'>): Promise<Metadata> {
  const [locale, params, events, t] = await Promise.all([
    getLang(),
    props.searchParams,
    getEvents(),
    getTranslations('meta'),
  ]);
  // Filtered views are shareable but should not compete with the main page in search results.
  const filtered = FILTER_KEYS.some((key) => key in params);
  // During a seasonal sale the title carries its name ("2026 黑五网一软件优惠与折扣码").
  const season = featuredEvent(events, getNow());
  return {
    title:
      season?.kind === 'seasonal'
        ? t('seasonTitle', { event: pick(season.name, locale) })
        : undefined,
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
  const featured = featuredEvent(events, now);
  const filters = parseFilters(params);
  const activeCount = deals.filter((d) => dealState(d, now) !== 'ended').length;
  const home = pageUrl('/', locale);

  return (
    <>
      <Hero event={featured} filters={filters} activeCount={activeCount} now={now} />
      <section
        aria-labelledby="deals-title"
        className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 sm:pt-7 lg:px-8"
      >
        <h2 id="deals-title" className="sr-only">
          {t('discover.title')}
        </h2>
        <Discovery
          deals={deals}
          filters={filters}
          page={parsePage(params.page)}
          basePath="/"
          hideSearch
          now={now}
        />
      </section>
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
