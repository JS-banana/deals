import { CATEGORIES, LOCALES, TOPICS } from '@deals/core';
import type { MetadataRoute } from 'next';
import { getEvents, getPublishedDeals } from '@/lib/data';
import { languageAlternates, pageUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/** Every public page in both languages, each with its hreflang alternates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [deals, events] = await Promise.all([getPublishedDeals(), getEvents()]);
  const paths = [
    '/',
    '/events',
    '/privacy',
    ...events.map((e) => `/events/${e.slug}`),
    ...CATEGORIES.map((c) => `/category/${c.slug}`),
    ...TOPICS.map((topic) => `/topics/${topic.slug}`),
    ...Array.from(new Set(deals.map((d) => d.product.slug)), (slug) => `/p/${slug}`),
  ];

  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: pageUrl(path, locale),
      alternates: { languages: languageAlternates(path) },
    })),
  );
}
