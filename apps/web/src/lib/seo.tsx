import type { Locale } from '@deals/core';
import type { Metadata } from 'next';
import { getPathname } from '@/i18n/navigation';
import { siteUrl } from './data';

/** Path of a page in a given locale (`/en/p/x` or `/p/x`), without the origin. */
export const localePath = (path: string, locale: Locale) => getPathname({ href: path, locale });

/** Absolute URL of a page in a given locale. */
export const pageUrl = (path: string, locale: Locale) => siteUrl(localePath(path, locale));

/** Canonical URL, hreflang alternates and the RSS feed link for a page. */
export function alternatesFor(path: string, locale: Locale): Metadata['alternates'] {
  return {
    canonical: localePath(path, locale),
    languages: {
      'zh-CN': localePath(path, 'zh'),
      en: localePath(path, 'en'),
      'x-default': localePath(path, 'zh'),
    },
    types: { 'application/rss+xml': locale === 'en' ? '/en/feed.xml' : '/feed.xml' },
  };
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serialised on the server with `<` escaped
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
