import { ArrowUpRight } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CommunityVotes } from '@/components/deals/community-votes';
import { DealModal } from '@/components/deals/deal-modal';
import { DealFacts, DealPanel, ProductHeader } from '@/components/deals/product-detail';
import { getLang, getNow, getProductDeals } from '@/lib/data';
import { dealHref, mainDeal } from '@/lib/deal-view';
import { localePath } from '@/lib/seo';

/** The deal over the listing (intercepts `/p/<slug>` on client-side navigation). */
export default async function ProductModal({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ offer?: string | string[] }>;
}) {
  const { slug } = await params;
  const [locale, deals, t] = await Promise.all([
    getLang(),
    getProductDeals(slug),
    getTranslations('product'),
  ]);
  const now = getNow();
  const deal = mainDeal(deals, now, (await searchParams).offer);
  if (!deal) notFound();
  return (
    <DealModal>
      <div className="space-y-5">
        <ProductHeader product={deal.product} level="h2" compact />
        <DealPanel deal={deal} now={now} variant="modal" />
        <DealFacts deal={deal} now={now} variant="modal" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <CommunityVotes dealId={deal.id} compact />
          {/* A plain anchor: a full navigation skips interception and renders the product page. */}
          <a
            href={localePath(dealHref(slug, deal.id), locale)}
            className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('viewFull')}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </DealModal>
  );
}
