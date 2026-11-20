import { notFound } from 'next/navigation';
import * as rootParams from 'next/root-params';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async () => {
  const locale = await rootParams.locale();
  if (!hasLocale(routing.locales, locale)) notFound();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Exact deal times are shown in Beijing time on the Chinese site and in UTC on the English one.
    timeZone: locale === 'zh' ? 'Asia/Shanghai' : 'UTC',
  };
});
