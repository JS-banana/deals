import { CATEGORIES, LOCALES, TOPICS } from '@deals/core';
import type { MetadataRoute } from 'next';
import { getEvents, getPublishedDeals, siteUrl } from '@/lib/data';
import { localePath } from '@/lib/seo';

export const dynamic = 'force-dynamic';

/** Date of the last human content review of the About page. */
const ABOUT_UPDATED = '2026-11-20';

/** ISO dates sort as strings, so the newest is the last one. */
const latest = (days: string[]) => new Date([...days].sort().at(-1) ?? '1970-01-01');

/** Every public page in both languages, each with its hreflang alternates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [deals, events] = await Promise.all([getPublishedDeals(), getEvents()]);
  const checked = (list: typeof deals) => list.map((d) => d.checkedOn);
  const all = latest(checked(deals));

  const pages: { path: string; lastModified: Date }[] = [
    { path: '/', lastModified: all },
    { path: '/events', lastModified: all },
    { path: '/about', lastModified: new Date(ABOUT_UPDATED) },
    ...events.map((e) => ({
      path: `/events/${e.slug}`,
      lastModified: latest(checked(deals.filter((d) => d.event.slug === e.slug))),
    })),
    ...CATEGORIES.map((c) => ({
      path: `/category/${c.slug}`,
      lastModified: latest(checked(deals.filter((d) => d.product.category === c.slug))),
    })),
    ...TOPICS.map((topic) => ({
      path: `/topics/${topic.slug}`,
      lastModified: latest(checked(deals.filter(topic.match))),
    })),
    ...[...Map.groupBy(deals, (d) => d.product.slug)].map(([slug, list]) => ({
      path: `/p/${slug}`,
      lastModified: latest(checked(list)),
    })),
  ];

  return pages.flatMap(({ path, lastModified }) =>
    LOCALES.map((locale) => ({
      url: siteUrl(localePath(path, locale)),
      lastModified,
      alternates: {
        languages: {
          'zh-CN': siteUrl(localePath(path, 'zh')),
          en: siteUrl(localePath(path, 'en')),
        },
      },
    })),
  );
}
