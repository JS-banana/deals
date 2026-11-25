import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  // English lives at the root, Chinese under /zh. No Accept-Language redirect: visitors and
  // crawlers should always see the same language at a given URL.
  localePrefix: 'as-needed',
  localeDetection: false,
  // Page metadata and the sitemap already identify the canonical language variants.
  alternateLinks: false,
});
