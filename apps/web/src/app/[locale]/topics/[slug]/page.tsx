import { dealState, parseFilters, pick, TOPICS } from '@deals/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Discovery, parsePage } from '@/components/deals/discovery';
import { Breadcrumbs } from '@/components/site/breadcrumbs';
import { PageHeader } from '@/components/site/page-header';
import { getLang, getNow, getPublishedDeals } from '@/lib/data';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata(
  props: PageProps<'/[locale]/topics/[slug]'>,
): Promise<Metadata> {
  const { slug } = await props.params;
  const topic = TOPICS.find((item) => item.slug === slug);
  if (!topic) return {};
  const locale = await getLang();
  return {
    title: pick(topic.title, locale),
    description: pick(topic.text, locale),
    alternates: alternatesFor(`/topics/${slug}`, locale),
  };
}

export default async function TopicPage(props: PageProps<'/[locale]/topics/[slug]'>) {
  const { slug } = await props.params;
  const topic = TOPICS.find((item) => item.slug === slug);
  if (!topic) notFound();
  const [params, deals, locale, t, tc] = await Promise.all([
    props.searchParams,
    getPublishedDeals(),
    getLang(),
    getTranslations('topics'),
    getTranslations('common'),
  ]);
  const now = getNow();
  const scoped = deals.filter(topic.match);
  const active = scoped.filter((d) => dealState(d, now) !== 'ended').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Breadcrumbs
        items={[
          { label: tc('home'), href: '/' },
          { label: pick(topic.title, locale), href: `/topics/${slug}` },
        ]}
      />
      <PageHeader
        title={pick(topic.title, locale)}
        text={pick(topic.text, locale)}
        meta={t('count', { count: active })}
      />
      <Discovery
        deals={scoped}
        filters={parseFilters(params)}
        page={parsePage(params.page)}
        basePath={`/topics/${slug}`}
        now={now}
      />
    </div>
  );
}
