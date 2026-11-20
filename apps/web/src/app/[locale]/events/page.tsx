import { dealState, pick } from '@deals/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EventCard } from '@/components/events/event-parts';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import { getEvents, getLang, getNow, getPublishedDeals } from '@/lib/data';
import { eventPhase } from '@/lib/deal-view';
import { alternatesFor, JsonLd, pageUrl } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLang(), getTranslations('events')]);
  return {
    title: t('title'),
    description: t('text'),
    alternates: alternatesFor('/events', locale),
  };
}

export default async function EventsPage() {
  const [events, deals, locale, t, tc] = await Promise.all([
    getEvents(),
    getPublishedDeals(),
    getLang(),
    getTranslations('events'),
    getTranslations('common'),
  ]);
  const now = getNow();
  const count = (slug: string) =>
    deals.filter((d) => d.event.slug === slug && dealState(d, now) !== 'ended').length;
  const seasonal = events.filter((e) => e.kind === 'seasonal');
  const sections = [
    { key: 'live', items: seasonal.filter((e) => eventPhase(e, now) === 'live') },
    { key: 'upcoming', items: seasonal.filter((e) => eventPhase(e, now) === 'upcoming') },
    { key: 'evergreen', items: events.filter((e) => e.kind === 'evergreen') },
    { key: 'past', items: seasonal.filter((e) => eventPhase(e, now) === 'ended') },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: tc('home'), href: '/' },
            { label: t('title'), href: '/events' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold sm:text-4xl">{t('title')}</h1>
          <p className="max-w-2xl text-muted-foreground">{t('text')}</p>
        </header>
      </div>
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`events-${section.key}`} className="space-y-4">
          <h2 id={`events-${section.key}`} className="text-xl font-semibold">
            {t(`section.${section.key}`)}
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {section.items.map((event) => (
              <li key={event.slug}>
                <EventCard
                  event={event}
                  count={count(event.slug)}
                  now={now}
                  highlight={section.key === 'live'}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: events.map((event, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: pick(event.name, locale),
            url: pageUrl(`/events/${event.slug}`, locale),
          })),
        }}
      />
    </div>
  );
}
