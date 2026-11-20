import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DealModal } from '@/components/deals/deal-modal';
import {
  DealFacts,
  DealPanel,
  DealSources,
  ProductHeader,
} from '@/components/deals/product-detail';
import { getLang, getNow, getProductDeals } from '@/lib/data';
import { mainDeal } from '@/lib/deal-view';
import { localePath } from '@/lib/seo';

/** The deal over the listing (intercepts `/p/<slug>` on client-side navigation). */
export default async function ProductModal({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const [locale, deals, t] = await Promise.all([
    getLang(),
    getProductDeals(slug),
    getTranslations('product'),
  ]);
  const now = getNow();
  const deal = mainDeal(deals, now);
  if (!deal) notFound();
  return (
    <DealModal>
      <div className="space-y-6">
        <ProductHeader product={deal.product} level="h2" />
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_19rem] md:items-start">
          <div className="order-2 space-y-6 md:order-1">
            <DealFacts deal={deal} now={now} />
            <DealSources deal={deal} now={now} />
          </div>
          <div className="order-1 md:order-2">
            <DealPanel deal={deal} now={now} />
          </div>
        </div>
        {/* A plain anchor: a full navigation skips interception and renders the product page. */}
        <a
          href={localePath(`/p/${slug}`, locale)}
          className="inline-flex min-h-10 items-center text-sm font-medium underline-offset-4 hover:underline"
        >
          {t('viewFull')}
        </a>
      </div>
    </DealModal>
  );
}
