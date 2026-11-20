import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['zh', 'en'],
  defaultLocale: 'zh',
  // Chinese lives at the root, English under /en. No Accept-Language redirect: many Chinese
  // developers run English systems, and crawlers should always see the same page per URL.
  localePrefix: 'as-needed',
  localeDetection: false,
});
