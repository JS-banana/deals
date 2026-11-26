import { type DealView, dealState, pick } from '@deals/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CommunityVotes } from '@/components/deals/community-votes';
import { DealCard } from '@/components/deals/deal-card';
import {
  DealFacts,
  DealHistory,
  DealPanel,
  PriceHistory,
  ProductHeader,
} from '@/components/deals/product-detail';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import {
  getLang,
  getNow,
  getProductDeals,
  getProductPriceHistory,
  getPublishedDeals,
  siteUrl,
} from '@/lib/data';
import { categoryName, deadline, logoSrc, mainDeal, priceParts } from '@/lib/deal-view';
import { alternatesFor, JsonLd, keywordList, pageUrl } from '@/lib/seo';

export async function generateMetadata(props: PageProps<'/[locale]/p/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const { offer } = await props.searchParams;
  const [locale, deals, t, td, fmt] = await Promise.all([
    getLang(),
    getProductDeals(slug),
    getTranslations('product'),
    getTranslations('deal'),
    getFormatter(),
  ]);
  const now = getNow();
  const deal = mainDeal(deals, now, offer);
  if (!deal) return {};
  const price = priceParts(deal, locale, td);
  const summary = [
    price.benefit,
    price.price && `${price.price}${price.unit ? ` ${price.unit}` : ''}`,
    price.discount,
  ]
    .filter(Boolean)
    .join(' · ');
  const due = deadline(deal, now, td, fmt);
  const description = [
    pick(deal.product.summary, locale),
    summary,
    due.secondary ? `${due.primary} · ${due.secondary}` : due.primary,
  ]
    .filter(Boolean)
    .join(' | ');
  const name = deal.product.name;
  const event = pick(deal.event.name, locale);
  // Seasonal deals put the sale in the title, matching searches like "TablePro black friday".
  const title =
    deal.event.kind === 'seasonal'
      ? t('metaTitleEvent', { name, event })
      : t('metaTitle', { name });
  return {
    title,
    description,
    keywords: [
      ...keywordList(t('metaKeywords', { name })),
      event,
      categoryName(deal.product.category, locale),
    ],
    // Offer links select a quote for visitors. Search indexes the stable product URL in each locale.
    alternates: alternatesFor(`/p/${slug}`, locale),
    openGraph: { title, description },
  };
}

export default async function ProductPage(props: PageProps<'/[locale]/p/[slug]'>) {
  const { slug } = await props.params;
  const { offer } = await props.searchParams;
  const [locale, deals, allDeals, history, t, tc] = await Promise.all([
    getLang(),
    getProductDeals(slug),
    getPublishedDeals(),
    getProductPriceHistory(slug),
    getTranslations('product'),
    getTranslations('common'),
  ]);
  const now = getNow();
  const deal = mainDeal(deals, now, offer);
  if (!deal) notFound();
  const { product } = deal;

  const points = history
    .filter((o) => o.dealId === deal.id && o.priceAmount !== null && o.currency === deal.currency)
    .map((o) => ({ id: o.id, at: o.observedAt, amount: o.priceAmount ?? 0 }));

  const similar: DealView[] = [];
  const candidates = allDeals
    .filter((d) => d.product.category === product.category && d.product.slug !== product.slug)
    .sort(
      (a, b) =>
        Number(dealState(a, now) === 'ended') - Number(dealState(b, now) === 'ended') ||
        a.rank - b.rank,
    );
  for (const d of candidates) {
    if (similar.length < 3 && !similar.some((s) => s.product.slug === d.product.slug)) {
      similar.push(d);
    }
  }

  const logo = logoSrc(product.logoPath);
  const state = dealState(deal, now);
  const validUntil = deal.endsAt ?? deal.endsOn;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Breadcrumbs
        items={[
          { label: tc('home'), href: '/' },
          {
            label: categoryName(product.category, locale),
            href: `/category/${product.category}`,
          },
          { label: product.name, href: `/p/${product.slug}` },
        ]}
      />
      <ProductHeader product={product} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-12">
        <div className="order-2 space-y-8 lg:order-1">
          <section aria-labelledby="facts-title" className="space-y-1">
            <h2 id="facts-title" className="text-lg font-semibold">
              {t('details')}
            </h2>
            <DealFacts deal={deal} now={now} />
          </section>
          <CommunityVotes dealId={deal.id} />
          <DealHistory deals={deals} currentId={deal.id} now={now} />
          {deal.currency && <PriceHistory points={points} currency={deal.currency} />}
        </div>
        <div className="order-1 lg:sticky lg:top-24 lg:order-2">
          <DealPanel deal={deal} now={now} />
        </div>
      </div>
      {similar.length > 0 && (
        <section aria-labelledby="similar-title" className="space-y-4 pt-4">
          <h2 id="similar-title" className="text-2xl font-semibold">
            {t('similar')}
          </h2>
          <ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {similar.map((d) => (
              <li key={d.id} className="min-w-0">
                <DealCard deal={d} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {logo && deal.priceAmount !== null && deal.currency && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: pick(product.summary, locale),
            url: pageUrl(`/p/${product.slug}`, locale),
            image: siteUrl(logo),
            offers: {
              '@type': 'Offer',
              price: deal.priceAmount,
              priceCurrency: deal.currency,
              ...(validUntil ? { priceValidUntil: validUntil } : {}),
              availability:
                state === 'ended'
                  ? 'https://schema.org/OutOfStock'
                  : state === 'upcoming'
                    ? 'https://schema.org/PreOrder'
                    : 'https://schema.org/InStock',
              url: deal.merchantUrl,
            },
          }}
        />
      )}
    </div>
  );
}
