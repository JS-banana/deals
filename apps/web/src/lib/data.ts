import 'server-only';
import { getDb, getProduct, listDeals, listEvents } from '@deals/db';
import { connection } from 'next/server';
import { cache } from 'react';

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

export function siteUrl(path = '/') {
  return new URL(path, process.env.SITE_URL ?? 'http://localhost:3000').toString();
}
