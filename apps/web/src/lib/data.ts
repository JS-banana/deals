import 'server-only';
import type { Locale } from '@deals/core';
import { getDb, getPriceHistory, getProduct, listDeals, listEvents } from '@deals/db';
import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { toLocale } from './deal-view';

/** Share public data across requests; keep rendering and the deal clock request-scoped. */
function publicQuery<Args extends unknown[], Result>(
  name: string,
  tag: 'deals' | 'events',
  query: (...args: Args) => Promise<Result>,
) {
  const cached = unstable_cache(query, [name], { revalidate: 60, tags: [tag] });
  return cache(async (...args: Args) => {
    await connection();
    return cached(...args);
  });
}

export const getPublishedDeals = publicQuery('published-deals', 'deals', () => listDeals(getDb()));
export const getEvents = publicQuery('events', 'events', () => listEvents(getDb()));
export const getProductBySlug = publicQuery('product', 'deals', (slug: string) =>
  getProduct(getDb(), slug),
);
export const getProductDeals = publicQuery('product-deals', 'deals', (slug: string) =>
  listDeals(getDb(), { productSlug: slug }),
);

const getObservations = publicQuery('price-history', 'deals', async (ids: number[]) => {
  const rows = await getPriceHistory(getDb(), ids);
  // Next's Data Cache uses JSON, including on disk. Store the same shape on hits and misses.
  return rows.map((row) => ({ ...row, observedAt: row.observedAt.toISOString() }));
});

/** Price observations of every published deal of a product, oldest first. */
export const getProductPriceHistory = cache(async (slug: string) => {
  const deals = await getProductDeals(slug);
  const rows = await getObservations(deals.map((d) => d.id));
  return rows.map((row) => ({ ...row, observedAt: new Date(row.observedAt) }));
});

/** One clock reading per request, so every card on a page agrees about "now". */
export const getNow = cache(() => new Date());

export async function getLang(): Promise<Locale> {
  return toLocale(await getLocale());
}

export function siteUrl(path = '/') {
  return new URL(path, process.env.SITE_URL ?? 'http://localhost:3000').toString();
}
