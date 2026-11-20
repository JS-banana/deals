import 'server-only';
import type { Locale } from '@deals/core';
import { getDb, getPriceHistory, getProduct, listDeals, listEvents } from '@deals/db';
import { connection } from 'next/server';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { toLocale } from './deal-view';

/*
 * Server-side data access for public pages. Every call happens at request time (`connection()`),
 * so deal states always reflect the current clock and freshly approved data; React `cache`
 * dedupes calls within one render (page + generateMetadata).
 */

export const getPublishedDeals = cache(async () => {
  await connection();
  return listDeals(getDb());
});

export const getEvents = cache(async () => {
  await connection();
  return listEvents(getDb());
});

export const getProductBySlug = cache(async (slug: string) => {
  await connection();
  return getProduct(getDb(), slug);
});

export const getProductDeals = cache(async (slug: string) => {
  await connection();
  return listDeals(getDb(), { productSlug: slug });
});

/** Price observations of every published deal of a product, oldest first. */
export const getProductPriceHistory = cache(async (slug: string) => {
  const deals = await getProductDeals(slug);
  return getPriceHistory(
    getDb(),
    deals.map((d) => d.id),
  );
});

/** One clock reading per request, so every card on a page agrees about "now". */
export const getNow = cache(() => new Date());

export async function getLang(): Promise<Locale> {
  return toLocale(await getLocale());
}

export function siteUrl(path = '/') {
  return new URL(path, process.env.SITE_URL ?? 'http://localhost:3000').toString();
}
