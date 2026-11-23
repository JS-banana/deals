import type { DealEvent, DealView } from '@deals/core';
import { describe, expect, it } from 'vitest';
import { catalogPages, changedPaths } from './indexnow.ts';

const now = new Date('2026-11-20T12:00:00Z');
const event: DealEvent = {
  slug: 'bfcm',
  kind: 'seasonal',
  name: { zh: '黑五', en: 'Black Friday' },
  tagline: { zh: '优惠', en: 'Deals' },
  startsOn: null,
  endsOn: null,
  keyDates: [],
  featured: true,
};
const deal: DealView = {
  id: 1,
  rank: 1,
  status: 'published',
  product: {
    id: 1,
    slug: 'tablepro',
    name: 'TablePro',
    category: 'developer',
    website: null,
    summary: { zh: '数据库', en: '' },
    logoPath: null,
  },
  event: { id: 1, slug: event.slug, kind: event.kind, name: event.name },
  plan: { zh: '专业版', en: 'Pro' },
  priceAmount: 20,
  originalAmount: 30,
  currency: 'USD',
  billing: 'one_time',
  discountPercent: null,
  discountAmount: null,
  code: null,
  noCode: true,
  startsOn: null,
  endsOn: null,
  startsAt: null,
  endsAt: null,
  dateZone: null,
  observedLiveOn: null,
  offerKey: 'default',
  offerType: 'discount',
  estimatedValue: null,
  benefitSummary: null,
  howToClaim: null,
  observedEndedAt: null,
  oneTime: true,
  existingUsers: false,
  terms: { zh: '条款', en: 'Terms' },
  renewal: null,
  eligibility: null,
  cardNote: null,
  merchantUrl: 'https://example.com',
  sourceUrl: null,
  verified: true,
  checkedOn: '2026-11-20',
};

const pages = (...offers: DealView[]) => catalogPages(offers, [event], now);
const offersPages = [
  '/',
  '/p/tablepro',
  '/events/bfcm',
  '/category/developer',
  '/topics/developers',
  '/topics/lifetime',
];
const english = (path: string) => (path === '/' ? '/en' : `/en${path}`);
const both = (paths: string[]) => paths.flatMap((path) => [path, english(path)]).sort();

describe('IndexNow catalog changes', () => {
  it('includes the sitemap paths once in both languages on the initial run', () => {
    const first = changedPaths({}, pages(deal));
    expect(first).toEqual(
      expect.arrayContaining(both([...offersPages, '/about', '/events', '/category/ai'])),
    );
    expect(first).toHaveLength(new Set(first).size);
    expect(changedPaths(pages(deal), pages({ ...deal }))).toEqual([]);
  });

  it('submits a changed price only for pages carrying the offer', () => {
    expect(changedPaths(pages(deal), pages({ ...deal, priceAmount: 19 })).sort()).toEqual(
      both(offersPages),
    );
  });

  it('notifies both the old and new categories, topics and events after the product moves', () => {
    const event2 = { ...event, slug: 'season2' };
    const render = (d: DealView) => catalogPages([d], [event, event2], now);
    const moved: DealView = {
      ...deal,
      product: { ...deal.product, category: 'design' },
      event: { ...deal.event, slug: event2.slug },
    };
    expect(changedPaths(render(deal), render(moved)).sort()).toEqual(
      both([...offersPages, '/category/design', '/topics/creators', '/events/season2', '/events']),
    );
  });

  it('notifies removals, including the last published offer disappearing from a product', () => {
    expect(changedPaths(pages(deal), pages()).sort()).toEqual(both([...offersPages, '/events']));
    expect(pages()).not.toHaveProperty('/p/tablepro');
  });

  it('only resubmits English pages when an English translation replaces the Chinese fallback', () => {
    const translated = {
      ...deal,
      product: { ...deal.product, summary: { zh: '数据库', en: 'Database' } },
    };
    expect(changedPaths(pages(deal), pages(translated)).sort()).toEqual(
      offersPages.map(english).sort(),
    );
  });

  it('picks up expired offers even when no database fields changed', () => {
    const ending = { ...deal, endsOn: '2026-11-20' };
    const later = catalogPages([ending], [event], new Date('2026-11-21T12:00:00Z'));
    expect(changedPaths(pages(ending), later).sort()).toEqual(both([...offersPages, '/events']));
    expect(later).toHaveProperty('/p/tablepro');
  });
});
