import { dealState, isCategory, parseFilters } from '@deals/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Discovery, parsePage } from '@/components/deals/discovery';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import { PageHeader } from '@/components/site/page-header';
import { getLang, getNow, getPublishedDeals } from '@/lib/data';
import { CATEGORY_UI, categoryName } from '@/lib/deal-view';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata(
  props: PageProps<'/[locale]/category/[slug]'>,
): Promise<Metadata> {
  const { slug } = await props.params;
  if (!isCategory(slug)) return {};
  const [locale, t] = await Promise.all([getLang(), getTranslations('category')]);
  const name = categoryName(slug, locale);
  return {
    title: t('metaTitle', { name }),
    description: t('metaDescription', { name }),
    alternates: alternatesFor(`/category/${slug}`, locale),
  };
}

export default async function CategoryPage(props: PageProps<'/[locale]/category/[slug]'>) {
  const { slug } = await props.params;
  if (!isCategory(slug)) notFound();
  const [params, deals, locale, t, tc] = await Promise.all([
    props.searchParams,
    getPublishedDeals(),
    getLang(),
    getTranslations('category'),
    getTranslations('common'),
  ]);
  const now = getNow();
  const name = categoryName(slug, locale);
  const scoped = deals.filter((d) => d.product.category === slug);
  const active = scoped.filter((d) => dealState(d, now) !== 'ended').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Breadcrumbs
        items={[
          { label: tc('home'), href: '/' },
          { label: name, href: `/category/${slug}` },
        ]}
      />
      <PageHeader
        title={name}
        text={t('text', { name })}
        icon={CATEGORY_UI[slug].icon}
        tint={CATEGORY_UI[slug].tint}
        meta={t('count', { count: active })}
      />
      <Discovery
        deals={scoped}
        filters={parseFilters(params)}
        page={parsePage(params.page)}
        basePath={`/category/${slug}`}
        fixedCategory={slug}
        now={now}
      />
    </div>
  );
}
