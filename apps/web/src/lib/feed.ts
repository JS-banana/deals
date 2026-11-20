import { dealState, type Locale, pick } from '@deals/core';
import { createFormatter, createTranslator } from 'next-intl';
import { getPublishedDeals, siteUrl } from './data';
import { categoryName, deadline, priceParts, type T } from './deal-view';
import { localePath } from './seo';

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** RSS 2.0 feed with the latest active deals. Route handlers have no request locale, so it is explicit. */
export async function renderFeed(locale: Locale): Promise<Response> {
  const [all, { default: messages }] = await Promise.all([
    getPublishedDeals(),
    import(`../../messages/${locale}.json`),
  ]);
  const now = new Date();
  const t = createTranslator({ locale, messages, namespace: 'deal' }) as unknown as T;
  const fmt = createFormatter({ locale, timeZone: locale === 'zh' ? 'Asia/Shanghai' : 'UTC' });
  const meta = createTranslator({ locale, messages, namespace: 'meta' });

  const deals = all
    .filter((d) => dealState(d, now) !== 'ended')
    .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) || a.rank - b.rank)
    .slice(0, 30);

  const items = deals.map((deal) => {
    const price = priceParts(deal, locale, t);
    const due = deadline(deal, now, t, fmt);
    const headline = [
      price.price && `${price.price}${price.unit ? ` ${price.unit}` : ''}`,
      price.discount,
    ]
      .filter(Boolean)
      .join(' · ');
    const lines = [
      pick(deal.product.summary, locale),
      pick(deal.plan, locale),
      headline,
      deal.code ? `${t('code.label')}: ${deal.code}` : deal.noCode ? t('code.auto') : '',
      due.secondary ? `${due.primary} · ${due.secondary}` : due.primary,
    ].filter(Boolean);
    const url = siteUrl(localePath(`/p/${deal.product.slug}`, locale));
    return `    <item>
      <title>${escapeXml(`${deal.product.name} · ${headline}`)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">${escapeXml(`${url}#deal-${deal.id}`)}</guid>
      <pubDate>${new Date(`${deal.checkedOn}T00:00:00Z`).toUTCString()}</pubDate>
      <category>${escapeXml(categoryName(deal.product.category, locale))}</category>
      <description>${escapeXml(lines.join(' | '))}</description>
    </item>`;
  });

  const feedUrl = siteUrl(locale === 'en' ? '/en/feed.xml' : '/feed.xml');
  const newest =
    deals
      .map((d) => d.checkedOn)
      .sort()
      .at(-1) ?? '1970-01-01';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(meta('siteName'))}</title>
    <link>${escapeXml(siteUrl(localePath('/', locale)))}</link>
    <description>${escapeXml(meta('description'))}</description>
    <language>${locale === 'zh' ? 'zh-CN' : 'en'}</language>
    <lastBuildDate>${new Date(`${newest}T00:00:00Z`).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
