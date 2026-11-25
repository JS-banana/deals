import type { Locale } from '@deals/core';
import type { Metadata } from 'next';
import { getPathname } from '@/i18n/navigation';
import { siteUrl } from './data';

/** Path of a page in a given locale (`/zh/p/x` or `/p/x`), without the origin. */
export const localePath = (path: string, locale: Locale) => getPathname({ href: path, locale });

/** Path of the RSS feed in a given locale. */
export const feedPath = (locale: Locale) => (locale === 'zh' ? '/zh/feed.xml' : '/feed.xml');

/** Absolute URL of a page in a given locale. */
export const pageUrl = (path: string, locale: Locale) => siteUrl(localePath(path, locale));

/** Language variants used in both the document head and the XML sitemap. */
export function languageAlternates(path: string) {
  const en = pageUrl(path, 'en');
  return { en, 'zh-CN': pageUrl(path, 'zh'), 'x-default': en };
}

/** Canonical URL, hreflang alternates and the RSS feed link for a page. */
export function alternatesFor(path: string, locale: Locale): Metadata['alternates'] {
  return {
    canonical: localePath(path, locale),
    languages: languageAlternates(path),
    types: { 'application/rss+xml': feedPath(locale) },
  };
}

/** Keywords meta from a comma-separated message. Google ignores it; Baidu and Bing still read it. */
export const keywordList = (text: string) =>
  text
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serialised on the server with `<` escaped
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
