/**
 * Idempotent bootstrap: the two standing events plus the hand-curated 2026 BFCM catalog that
 * shipped with the original static site. Re-running updates rows in place.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type Billing,
  type CategorySlug,
  type Deal,
  type DealEvent,
  dealSchema,
  eventSchema,
  type Localized,
  type Product,
  productSchema,
} from '@deals/core';
import { createDb, dealColumns, deals, events, products } from './index.ts';

const EVENTS: DealEvent[] = [
  {
    slug: 'bfcm-2026',
    kind: 'seasonal',
    name: { zh: '2026 黑五网一', en: 'Black Friday & Cyber Monday 2026' },
    tagline: {
      zh: '一年里软件折扣最集中的一周。续费、授权和资格限制，一次看清。',
      en: 'The biggest software sale of the year, with renewals, licenses and fine print spelled out.',
    },
    startsOn: '2026-11-01',
    endsOn: '2026-12-07',
    keyDates: [
      { date: '2026-11-27', label: { zh: '黑色星期五', en: 'Black Friday' } },
      { date: '2026-11-30', label: { zh: '网络星期一', en: 'Cyber Monday' } },
    ],
    featured: true,
  },
  {
    slug: 'evergreen',
    kind: 'evergreen',
    name: { zh: '常年优惠', en: 'Always-on deals' },
    tagline: {
      zh: '教育优惠、买断授权和长期折扣，不必等大促。',
      en: 'Education pricing, lifetime licenses and standing discounts. No sale required.',
    },
    startsOn: null,
    endsOn: null,
    keyDates: [],
    featured: false,
  },
];

const CATEGORY_BY_NAME: Record<string, CategorySlug> = {
  'AI 工具': 'ai',
  开发工具: 'developer',
  效率软件: 'productivity',
  设计创作: 'design',
  云服务: 'cloud',
  实用工具: 'utilities',
};
const CURRENCY_BY_SYMBOL: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

interface LegacyDeal {
  slug: string;
  name: string;
  category: string;
  summary: string;
  plan: string;
  offer: string;
  original: string | null;
  discount: string | null;
  discountPercent: number | null;
  terms: string;
  renewal: string;
  eligibility: string;
  code: string;
  noCode?: boolean;
  start: string | null;
  end: string | null;
  startsAt?: string;
  endsAt?: string;
  dateZone?: string;
  observedLive?: string;
  oneTime: boolean;
  existing: boolean;
  merchant: string;
  source: string;
  verified: boolean;
  checked: string;
  cardNote?: string;
}

const zh = (text: string | undefined): Localized | null => (text ? { zh: text, en: '' } : null);

function money(text: string | null | undefined): { amount: number; currency: string } | null {
  const match = /^([$€£])\s?([\d,]+(?:\.\d+)?)$/.exec(text?.trim() ?? '');
  if (!match?.[1] || !match[2]) return null;
  return {
    amount: Number(match[2].replace(/,/g, '')),
    currency: CURRENCY_BY_SYMBOL[match[1]] ?? 'USD',
  };
}

function billingOf(d: LegacyDeal): Billing {
  if (d.oneTime) return 'one_time';
  if (d.plan.includes('首年')) return 'first_year';
  if (d.plan.includes('年付')) return 'year';
  if (d.plan.includes('月付') || d.plan.includes('月最低')) return 'month';
  return 'other';
}

function convert(d: LegacyDeal): { product: Product; deal: Deal } {
  const price = money(d.offer);
  const original = money(d.original);
  const saved = /^省\s*([$€£][\d.,]+)$/.exec(d.discount?.trim() ?? '');
  const savedMoney = saved?.[1] ? money(saved[1]) : null;
  const category = CATEGORY_BY_NAME[d.category];
  if (!category) throw new Error(`${d.slug}: unknown category ${d.category}`);
  const product = productSchema.parse({
    slug: d.slug,
    name: d.name,
    category,
    website: new URL(d.merchant).origin,
    summary: { zh: d.summary, en: '' },
    logoPath: null,
  });
  const deal = dealSchema.parse({
    plan: { zh: d.plan, en: '' },
    priceAmount: price?.amount ?? null,
    originalAmount: original?.amount ?? null,
    currency: price?.currency ?? original?.currency ?? savedMoney?.currency ?? null,
    billing: billingOf(d),
    discountPercent: d.discountPercent,
    discountAmount: d.discountPercent === null ? (savedMoney?.amount ?? null) : null,
    code: d.code || null,
    noCode: Boolean(d.noCode),
    startsOn: d.start,
    endsOn: d.end,
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    dateZone: d.dateZone ?? null,
    observedLiveOn: d.observedLive ?? null,
    oneTime: d.oneTime,
    existingUsers: d.existing,
    terms: { zh: d.terms, en: '' },
    renewal: zh(d.renewal),
    eligibility: zh(d.eligibility),
    cardNote: zh(d.cardNote),
    merchantUrl: d.merchant,
    sourceUrl: d.source,
    verified: d.verified,
    checkedOn: d.checked,
  });
  return { product, deal };
}

const legacy: LegacyDeal[] = JSON.parse(
  await readFile(path.join(import.meta.dirname, '../seed/legacy-deals.json'), 'utf8'),
);
const converted = legacy.map(convert);
const db = createDb();

await db.transaction(async (tx) => {
  const eventIds = new Map<string, number>();
  for (const event of EVENTS) {
    const values = eventSchema.parse(event);
    const [row] = await tx
      .insert(events)
      .values(values)
      .onConflictDoUpdate({ target: events.slug, set: values })
      .returning({ id: events.id });
    if (row) eventIds.set(event.slug, row.id);
  }
  const eventId = eventIds.get('bfcm-2026');
  if (!eventId) throw new Error('bfcm-2026 missing');
  for (const [index, { product, deal }] of converted.entries()) {
    const [productRow] = await tx
      .insert(products)
      .values(product)
      .onConflictDoUpdate({
        target: products.slug,
        set: { name: product.name, category: product.category, website: product.website },
      })
      .returning({ id: products.id });
    if (!productRow) throw new Error(`${product.slug}: product upsert failed`);
    const columns = dealColumns(deal);
    await tx
      .insert(deals)
      .values({
        ...columns,
        productId: productRow.id,
        eventId,
        status: 'published',
        rank: index * 10,
      })
      .onConflictDoUpdate({
        target: [deals.productId, deals.eventId],
        set: { rank: index * 10 },
      });
  }
});

await db.$client.end();
console.log(`seeded ${EVENTS.length} events and ${converted.length} deals`);
