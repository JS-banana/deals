import { dealState, parseFilters, pick } from '@deals/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Discovery, parsePage } from '@/components/deals/discovery';
import { EventHero } from '@/components/events/event-parts';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import { getEvents, getLang, getNow, getPublishedDeals } from '@/lib/data';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata(
  props: PageProps<'/[locale]/events/[slug]'>,
): Promise<Metadata> {
  const { slug } = await props.params;
  const [events, locale] = await Promise.all([getEvents(), getLang()]);
  const event = events.find((e) => e.slug === slug);
  if (!event) return {};
  return {
    title: pick(event.name, locale),
    description: pick(event.tagline, locale),
    alternates: alternatesFor(`/events/${slug}`, locale),
  };
}

export default async function EventPage(props: PageProps<'/[locale]/events/[slug]'>) {
  const { slug } = await props.params;
  const [params, events, allDeals, locale, t, tc] = await Promise.all([
    props.searchParams,
    getEvents(),
    getPublishedDeals(),
    getLang(),
    getTranslations('events'),
    getTranslations('common'),
  ]);
  const event = events.find((e) => e.slug === slug);
  if (!event) notFound();
  const now = getNow();
  const deals = allDeals.filter((d) => d.event.slug === slug);
  const active = deals.filter((d) => dealState(d, now) !== 'ended').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Breadcrumbs
        items={[
          { label: tc('home'), href: '/' },
          { label: t('title'), href: '/events' },
          { label: pick(event.name, locale), href: `/events/${slug}` },
        ]}
      />
      <EventHero event={event} count={active} now={now} />
      <Discovery
        deals={deals}
        filters={parseFilters(params)}
        page={parsePage(params.page)}
        basePath={`/events/${slug}`}
        now={now}
      />
    </div>
  );
}
