import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DealCard } from '@/components/deals/deal-card';
import { SavedList } from '@/components/deals/saved-list';
import { getLang, getNow, getPublishedDeals } from '@/lib/data';
import { mainDeal } from '@/lib/deal-view';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLang(), getTranslations('saved')]);
  return {
    title: t('title'),
    description: t('text'),
    alternates: alternatesFor('/saved', locale),
    robots: { index: false, follow: true },
  };
}

export default async function SavedPage() {
  const [deals, t] = await Promise.all([getPublishedDeals(), getTranslations('saved')]);
  const now = getNow();
  const bySlug = Map.groupBy(deals, (d) => d.product.slug);
  const items = [...bySlug].flatMap(([slug, productDeals]) => {
    const main = mainDeal(productDeals, now);
    return productDeals.map((deal) => ({
      slug: `${slug}#${deal.id}`,
      legacy: deal.id === main?.id ? slug : null,
      card: <DealCard deal={deal} now={now} />,
    }));
  });
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('text')}</p>
      </header>
      <SavedList items={items} />
    </div>
  );
}
