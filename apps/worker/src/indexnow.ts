import {
  CATEGORIES,
  type DealEvent,
  type DealView,
  dealState,
  eventPhase,
  LOCALES,
  pick,
  TOPICS,
} from '@deals/core';
import { eq, listDeals, listEvents, syncState, withAdvisoryLock } from '@deals/db';
import type { Ctx } from './runtime.ts';
import { bump, sha256 } from './util.ts';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH_SIZE = 10_000;

type PageHashes = Record<string, string>;

/** Track the published offers and events on their canonical pages, including translation fallbacks. */
export function catalogPages(deals: DealView[], events: DealEvent[], now: Date): PageHashes {
  const pages: PageHashes = {};
  const addPage = (path: string, content: unknown) => {
    for (const locale of LOCALES) {
      const localized = locale === 'en' ? path : path === '/' ? '/zh' : `/zh${path}`;
      pages[localized] = sha256(
        JSON.stringify([locale, content], (_key, value) =>
          typeof value?.zh === 'string' && typeof value.en === 'string'
            ? pick(value, locale)
            : value,
        ),
      );
    }
  };

  const offers = deals.map((deal) => ({ deal, state: dealState(deal, now) }));
  const active = offers.filter((offer) => offer.state !== 'ended');
  const eventCards = events.map(({ featured, ...event }) => {
    const scoped = offers.filter((offer) => offer.deal.event.slug === event.slug);
    const listed = scoped.filter((offer) => offer.state !== 'ended');
    const card = { event, phase: eventPhase(event, now), count: listed.length };
    addPage(`/events/${event.slug}`, [card, scoped.length, listed]);
    return { card, featured };
  });
  addPage('/', [
    eventCards.find(({ featured, card }) => featured && card.phase !== 'ended')?.card,
    active,
    TOPICS.map(({ slug, title, text }) => ({ slug, title, text })),
  ]);
  addPage(
    '/events',
    eventCards.map(({ card }) => card),
  );
  addPage('/about', []);
  for (const category of CATEGORIES) {
    addPage(`/category/${category.slug}`, [
      category.name,
      active.filter(({ deal }) => deal.product.category === category.slug),
    ]);
  }
  for (const topic of TOPICS) {
    addPage(`/topics/${topic.slug}`, [
      topic.title,
      topic.text,
      active.filter(({ deal }) => topic.match(deal)),
    ]);
  }
  // A product remains public with an expired offer, and disappears with its last unpublished offer.
  const products = new Map<string, typeof offers>();
  for (const offer of offers) {
    const slug = offer.deal.product.slug;
    const list = products.get(slug);
    if (list) list.push(offer);
    else products.set(slug, [offer]);
  }
  for (const [slug, list] of products) addPage(`/p/${slug}`, list);
  return pages;
}

/** Missing paths are removals: submit the old URL so engines can discover its 404. */
export function changedPaths(previous: PageHashes, current: PageHashes): string[] {
  const paths = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...paths].filter((path) => previous[path] !== current[path]);
}

export async function indexNow(ctx: Ctx) {
  const { siteUrl, indexNowKey: key } = ctx.config;
  if (!siteUrl || (!ctx.dryRun && !key)) {
    ctx.log('skipped: configure SITE_URL and INDEXNOW_KEY to submit URLs');
    return;
  }
  if (!ctx.dryRun && !/^[a-zA-Z0-9-]{8,128}$/.test(key ?? '')) {
    throw new Error('INDEXNOW_KEY must contain 8–128 letters, digits or hyphens');
  }
  const site = new URL(siteUrl);
  const stateKey = `indexnow:${site.origin}`;

  async function sync() {
    const [[row], deals, events] = await Promise.all([
      ctx.db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, stateKey)),
      listDeals(ctx.db),
      listEvents(ctx.db),
    ]);
    const accepted = (row?.value ?? {}) as PageHashes;
    const current = catalogPages(deals, events, new Date());
    const paths = changedPaths(accepted, current);
    ctx.stats.urls = paths.length;
    if (!paths.length) return ctx.log('no public pages changed');

    const url = (path: string) => new URL(path, site).href;
    if (ctx.dryRun)
      return ctx.log(`would submit ${paths.length} URLs:\n${paths.map(url).join('\n')}`);

    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch = paths.slice(i, i + BATCH_SIZE);
      // The verification file is served at the protocol's default location, /{key}.txt.
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: site.host, key, urlList: batch.map(url) }),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
      });
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`IndexNow returned HTTP ${response.status}`);
      }
      ctx.log(`IndexNow accepted ${batch.length} URLs (HTTP ${response.status})`);
      bump(ctx.stats, 'submitted', batch.length);
      for (const path of batch) {
        const hash = current[path];
        if (hash === undefined) delete accepted[path];
        else accepted[path] = hash;
      }
      // Commit each accepted batch independently so a failed later batch can resume.
      await ctx.db
        .insert(syncState)
        .values({ key: stateKey, value: accepted })
        .onConflictDoUpdate({ target: syncState.key, set: { value: accepted } });
    }
  }

  if (ctx.dryRun) return sync();
  if (!(await withAdvisoryLock(ctx.db, stateKey, sync))) {
    ctx.log('another IndexNow submission is already running');
  }
}
