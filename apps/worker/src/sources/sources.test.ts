import type { Deal } from '@deals/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedHost, offerKeyFor } from '../extract.ts';
import type { Ctx } from '../runtime.ts';
import { triage } from '../triage.ts';
import { parseReadme } from '../upstream.ts';
import { missingMerchantEvidence } from '../verify.ts';
import { hackerNews, reddit, redditConfigured, searchWeb, webSearch } from './community.ts';
import { parseFeed, rss as readFeed } from './rss.ts';
import type { SourceConfig } from './types.ts';

const config: SourceConfig = {
  id: 'test',
  type: 'rss',
  target: 'https://feed.example/rss',
  enabled: true,
  quota: 15,
};
function fixture(data: unknown) {
  return {
    signal: new AbortController().signal,
    fetcher: {
      raw: vi.fn(async () => ({
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(data)),
      })),
    },
  } as unknown as Ctx;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('source contracts', () => {
  it('trusts merchant roots and their subdomains', () => {
    const trusted = ['jetbrains.com'];
    for (const host of ['jetbrains.com', 'blog.jetbrains.com', 'account.jetbrains.com'])
      expect(isTrustedHost(host, trusted)).toBe(true);
    for (const host of ['eviljetbrains.com', 'jetbrains.com.evil.example', null])
      expect(isTrustedHost(host, trusted)).toBe(false);
    expect(isTrustedHost('github.com', ['github.com'])).toBe(false);
    expect(isTrustedHost('tenant.github.com', ['tenant.github.com'])).toBe(false);
    expect(isTrustedHost('jetbrains.com', [])).toBe(false);
    expect(isTrustedHost('', [''])).toBe(false);
  });
  it('reads opaque guids and Atom alternate links and rejects HTML error pages', () => {
    const rss =
      '<rss><channel><item><guid>opaque</guid><title>API grant</title><link>https://shop.example/a</link><description>300 credits</description></item></channel></rss>';
    const atom =
      '<feed><entry><id>opaque</id><title>API grant</title><link rel="self" href="/old"/><link rel="alternate" href="https://shop.example/b"/></entry></feed>';
    expect(parseFeed(rss, config)[0]?.signalKey).toBe(parseFeed(atom, config)[0]?.signalKey);
    expect(parseFeed(atom, config)[0]?.candidateUrls).toEqual(['https://shop.example/b']);
    expect(() => parseFeed('<html>error</html>', config)).toThrow();
  });
  it('retains multiple offers, parses HTML and provider tables and skips fenced examples', () => {
    const markdown = [
      '~~~',
      '- [Sample](https://example.org/) fake deal',
      '~~~',
      '| **Name** | **Deal details** |',
      '|---|---|',
      '| [Pro](https://x.example/) | Grant |',
      '| [Pro](https://x.example/) | 30% OFF |',
      '<table><tr><th>App</th><th>Offer</th></tr><tr><td><a href="https://a.example">A</a></td><td>30% off</td></tr></table>',
      '| Provider | Free Models | Get API Key |',
      '| --- | --- | --- |',
      '| API | 82 | <a href="https://api.example">→</a> |',
    ].join('\n');
    expect(
      parseReadme(markdown, true)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['A', 'API', 'Pro', 'Pro']);
  });
  it('filters community scores, uses per-provider credentials and checks search freshness', async () => {
    const post = {
      name: 't3_1',
      title: 'Promo',
      permalink: '/r/a/comments/1',
      score: 7,
      created_utc: 123,
      url: 'https://shop.example/offer',
    };
    vi.stubEnv('REDDIT_ACCESS_TOKEN', 'fixture').stubEnv('SEARCH_API_KEY', 'fixture');
    const ctx = fixture({ data: { children: [{ data: post }, { data: { ...post, score: 2 } }] } });
    expect(
      (await reddit(ctx, { ...config, type: 'reddit', target: 'a' }, null)).signals.map(
        (s) => s.signalKey,
      ),
    ).toEqual(['t3_1']);
    const hn = fixture({
      hits: [
        {
          objectID: '2',
          title: 'Promo',
          url: 'https://shop.example/',
          created_at_i: 123,
          points: 12,
        },
      ],
    });
    expect((await hackerNews(hn, config, null)).signals[0]?.sourceUrl).toContain('item?id=2');
    const hits = fixture({
      web: {
        results: [
          { url: 'https://shop.example/', page_age: '2000-01-01' },
          { url: 'https://shop.example/new', description: 'new' },
        ],
      },
    });
    expect((await searchWeb(hits, 'software')).map((h) => h.url)).toEqual([
      'https://shop.example/new',
    ]);
    expect(vi.mocked(hits.fetcher.raw).mock.calls[0]?.[1].headers).toEqual({
      'X-Subscription-Token': 'fixture',
    });
  });
  it('rejects incomplete batches and unlisted model URLs', async () => {
    const signals = parseFeed(
      '<rss><item><guid>1</guid><title>Promo</title><link>https://shop.example/</link></item></rss>',
      config,
    );
    const ctx = {
      extractLlm: {
        json: async (r: { parse: (v: unknown) => unknown }) =>
          r.parse({
            results: [
              {
                id: 0,
                isDeal: true,
                productName: 'Product',
                offerType: 'discount',
                merchantUrl: 'https://unlisted.example',
              },
            ],
          }),
      },
    } as unknown as Ctx;
    expect((await triage(ctx, signals))[0]?.merchantUrl).toBeNull();
    await expect(triage(ctx, [...signals, ...signals])).rejects.toThrow();
  });
  it('gets and reuses an app-only Reddit grant from the fixed token endpoint', async () => {
    vi.stubEnv('REDDIT_ACCESS_TOKEN', '')
      .stubEnv('REDDIT_CLIENT_ID', 'test-id')
      .stubEnv('REDDIT_CLIENT_SECRET', 'test-secret');
    const exchange = vi.fn(async () =>
      Response.json({ access_token: 'issued', token_type: 'bearer', expires_in: 3600 }),
    );
    vi.stubGlobal('fetch', exchange);
    const ctx = fixture({ data: { children: [] } });
    const sub = { ...config, target: 'macapps' };
    expect(redditConfigured()).toBe(true);
    await reddit(ctx, sub, null);
    await reddit(ctx, sub, null);
    expect(exchange).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledWith(
      'https://www.reddit.com/api/v1/access_token',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        body: 'grant_type=client_credentials',
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from('test-id:test-secret').toString('base64')}`,
        }),
      }),
    );
    expect(vi.mocked(ctx.fetcher.raw).mock.calls[0]?.[1].headers).toEqual({
      authorization: 'Bearer issued',
    });
    vi.stubEnv('REDDIT_ACCESS_TOKEN', 'supplied');
    await reddit(ctx, sub, null);
    expect(vi.mocked(ctx.fetcher.raw).mock.lastCall?.[1].headers).toEqual({
      authorization: 'Bearer supplied',
    });
    expect(exchange).toHaveBeenCalledOnce();
  });

  it('paginates recent HN stories and handles ties, edits and score-only changes', async () => {
    const seconds = Math.floor(Date.now() / 1000) - 60;
    const post = {
      objectID: '1',
      title: 'Credit grant',
      url: 'https://merchant.example',
      created_at_i: seconds,
      points: 10,
    };
    const ctx = fixture({});
    const raw = vi.mocked(ctx.fetcher.raw);
    let next = { ...post, objectID: '2' };
    raw.mockImplementation(async (url) => ({
      status: 200,
      url,
      contentType: 'application/json',
      truncated: false,
      body: Buffer.from(
        JSON.stringify({
          nbPages: 2,
          hits:
            new URL(url).searchParams.get('page') === '0'
              ? [post, null, { ...post, objectID: 'invalid' }, { ...post, points: 2 }]
              : [next, { ...post, url: 'https://127.0.0.1', objectID: '3' }],
        }),
      ),
    }));
    const first = await hackerNews(ctx, config, null);
    expect(first.signals.map((s) => s.signalKey)).toEqual(['1', '2', '3']);
    expect(first.signals[2]?.candidateUrls).toEqual([]);
    next = { ...next, points: 42 };
    const repeat = await hackerNews(ctx, config, first.cursor);
    expect(repeat).toEqual({ cursor: first.cursor, signals: [] });
    next = { ...next, title: 'Changed grant' };
    expect((await hackerNews(ctx, config, first.cursor)).signals.map((s) => s.title)).toEqual([
      'Changed grant',
    ]);
  });

  it('renews a rejected app grant once and fails closed on a malformed token response', async () => {
    vi.stubEnv('REDDIT_ACCESS_TOKEN', '')
      .stubEnv('REDDIT_CLIENT_ID', 'renew-id')
      .stubEnv('REDDIT_CLIENT_SECRET', 'fixture');
    const token = (value: string) =>
      Response.json({ access_token: value, token_type: 'bearer', expires_in: 3600 });
    const exchange = vi
      .fn()
      .mockResolvedValueOnce(token('first'))
      .mockResolvedValueOnce(token('renewed'));
    vi.stubGlobal('fetch', exchange);
    const ctx = fixture({ data: { children: [] } });
    const sub = { ...config, target: 'macapps' };
    vi.mocked(ctx.fetcher.raw).mockResolvedValueOnce({
      status: 401,
      url: 'https://oauth.reddit.com/',
      contentType: 'application/json',
      truncated: false,
      body: Buffer.alloc(0),
    });
    await reddit(ctx, sub, null);
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ctx.fetcher.raw).mock.lastCall?.[1].headers).toEqual({
      authorization: 'Bearer renewed',
    });
    vi.stubEnv('REDDIT_CLIENT_ID', 'bad-grant');
    exchange.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }));
    await expect(reddit(ctx, sub, null)).rejects.toThrow('Invalid Reddit OAuth response');
    expect(ctx.fetcher.raw).toHaveBeenCalledTimes(2);
  });

  it('reads Reddit after cursors and admits previously low-score posts in the overlap', async () => {
    vi.stubEnv('REDDIT_ACCESS_TOKEN', 'test');
    const seconds = Math.floor(Date.now() / 1000) - 60;
    const post = (id: string, score: number) => ({
      data: {
        name: `t3_${id}`,
        title: 'Grant',
        score,
        created_utc: seconds,
        permalink: `/r/a/comments/${id}/grant/`,
        url: 'https://shop.example/offer',
        selftext:
          'Claim at https://shop.example/offer or https://shop.example/new. See https://[::1]/.',
      },
    });
    const ctx = fixture({});
    let score = 2;
    vi.mocked(ctx.fetcher.raw).mockImplementation(async (url) => {
      const after = new URL(url).searchParams.get('after');
      const data = after
        ? { after: null, children: [post('2', score)] }
        : {
            after: 't3_1',
            children: [post('1', 8), null, { data: { ...post('9', 8).data, created_utc: 'bad' } }],
          };
      return {
        url,
        status: 200,
        truncated: false,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ data })),
      };
    });
    const sub = { ...config, target: 'a' };
    const first = await reddit(ctx, sub, null);
    expect(first.signals.map((s) => s.signalKey)).toEqual(['t3_1']);
    expect(first.signals[0]?.candidateUrls).toEqual([
      'https://shop.example/offer',
      'https://shop.example/new',
    ]);
    score = 10;
    const second = await reddit(ctx, sub, first.cursor);
    expect(second.signals.map((s) => s.signalKey)).toEqual(['t3_2']);
    expect(await reddit(ctx, sub, second.cursor)).toEqual({ cursor: second.cursor, signals: [] });
  });

  it('enqueues only dated Brave discoveries in the last 48 hours and ignores malformed results', async () => {
    const hit = {
      url: 'https://shop.example/',
      title: 'Grant',
      page_age: new Date(Date.now() - 60_000).toISOString(),
    };
    const ctx = fixture({
      web: {
        results: [
          null,
          { ...hit, page_age: undefined },
          hit,
          hit,
          { ...hit, url: 'https://future.example', page_age: '2099-01-01' },
          { ...hit, url: 'https://no-date.example', page_age: undefined },
          { ...hit, url: 'https://expired.example', page_age: '2000-01-01' },
          { ...hit, url: 'https://malformed.example', description: 7 },
        ],
      },
    });
    const first = await webSearch(ctx, config, null);
    expect(first.signals.map((s) => s.sourceUrl)).toEqual([hit.url]);
    expect(first.signals[0]?.rawText).toBe('Grant');
    expect(await webSearch(ctx, config, first.cursor)).toEqual({
      cursor: first.cursor,
      signals: [],
    });
  });

  it('keys an RSSHub post by status ID and ignores changing V2EX reply anchors', async () => {
    const atom = (url: string, id: string) =>
      `<feed><entry><id>${id}</id><link rel="alternate" href="${url}"/><title>Offer</title><content>Free credit</content></entry></feed>`;
    const x = { ...config, type: 'x' as const };
    const a = parseFeed(atom('https://twitter.com/merchant/status/123', 'first-guid'), x);
    const b = parseFeed(atom('https://x.com/merchant/status/123?s=1', 'second-guid'), x);
    expect(a).toEqual(b);
    expect(a[0]?.signalKey).toBe('123');
    expect(parseFeed(atom('https://x.com/merchant', 'profile'), x)).toEqual([]);
    const ctx = fixture({});
    let replies = 1;
    vi.mocked(ctx.fetcher.raw).mockImplementation(async (url) => ({
      url,
      status: 200,
      contentType: 'application/atom+xml',
      truncated: false,
      body: Buffer.from(
        atom(`https://www.v2ex.com/t/123#reply${replies}`, 'tag:www.v2ex.com,2026-11-22:/t/123'),
      ),
    }));
    const first = await readFeed(ctx, config, null);
    expect(first.signals[0]?.candidateUrls).toEqual(['https://www.v2ex.com/t/123']);
    replies = 8;
    expect(await readFeed(ctx, config, first.cursor)).toEqual({
      cursor: first.cursor,
      signals: [],
    });
  });
  it('separates merchant tiers while deduplicating a grant across landing pages', () => {
    const deal = {
      offerType: 'free_credit',
      billing: 'other',
      code: null,
      merchantUrl: 'https://shop.example/claim',
    } as Deal;
    expect(offerKeyFor(deal)).toBe(
      offerKeyFor({ ...deal, merchantUrl: 'https://blog.example/announcement' }),
    );
    expect(offerKeyFor(deal, 'Solo')).not.toBe(offerKeyFor(deal, 'Pro'));
    expect(offerKeyFor(deal)).not.toBe(offerKeyFor({ ...deal, offerType: 'discount' }));
  });
  it('requires the merchant to attest amount, unit and eligibility of a credit grant', () => {
    const url = 'https://shop.example/';
    const quote = 'New customers only: USD 300 in API credits';
    const gaps = (summary: string, source = url) =>
      missingMerchantEvidence(
        { benefitSummary: { zh: summary, en: '' }, billing: 'other' } as Deal,
        [],
        [{ field: 'benefitSummary', quote, url: source }],
        { url, text: quote },
      );
    expect(gaps('仅限新客户：300 美元赠金')).toEqual([]);
    expect(gaps('仅限新客户：USD 300 API 赠金')).toEqual([]);
    expect(gaps('仅限新客户：USD 3.00 API 赠金')).toContain('benefitSummary');
    for (const text of [
      'USD 300 API 赠金',
      '仅限新客户：USD 30 API 赠金',
      '仅限新客户：300 tokens',
    ])
      expect(gaps(text)).toContain('benefitSummary');
    expect(gaps('仅限新客户：USD 300 API 赠金', 'https://community.example/')).toContain(
      'benefitSummary',
    );
  });
});
