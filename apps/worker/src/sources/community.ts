import { z } from 'zod';
import { USER_AGENT } from '../fetcher.ts';
import type { Ctx } from '../runtime.ts';
import { sha256 } from '../util.ts';
import {
  httpsLink,
  type RawSignal,
  readSource,
  type SourceAdapter,
  SourceHttpError,
} from './types.ts';

const HOUR = 3600;
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // Both providers expose at most 1,000 results from one listing.
const nowSeconds = () => Math.floor(Date.now() / 1000);
const epoch = z.number().positive().max(8.64e12);
const recentState = z.object({
  through: epoch,
  seen: z.array(z.string()).max(PAGE_SIZE * MAX_PAGES),
});
type RecentState = z.infer<typeof recentState>;

function previousState(cursor: string | null): RecentState {
  if (cursor) {
    try {
      const old = JSON.parse(cursor);
      const parsed = recentState.safeParse(old);
      if (parsed.success && parsed.data.through <= nowSeconds()) return parsed.data;
      // HN used to persist only the timestamp. Replay the overlap once to populate its seen set.
      if (epoch.safeParse(old).success && old <= nowSeconds()) return { through: old, seen: [] };
    } catch {
      // A legacy Reddit cursor was a single fullname.
    }
  }
  return { through: 0, seen: [] };
}

/** Poll an overlap for late score increases and edits, including ties at the high-water mark. */
function recentBatch(previous: RecentState, cursor: string | null, posts: RawSignal[]) {
  const seen = new Set(previous.seen);
  const latest = new Set<string>();
  const signals: RawSignal[] = [];
  let through = previous.through;
  for (const post of posts) {
    const fingerprint = sha256(
      JSON.stringify([post.signalKey, post.title, post.rawText, post.candidateUrls]),
    );
    if (latest.has(fingerprint)) continue;
    latest.add(fingerprint);
    if (!seen.has(fingerprint)) signals.push(post);
    through = Math.max(through, Date.parse(post.publishedAt ?? '') / 1000);
  }
  if (!signals.length) return { cursor, signals };
  return {
    cursor: JSON.stringify({
      through,
      seen: [...new Set([...latest, ...seen])].slice(0, PAGE_SIZE * MAX_PAGES),
    }),
    signals,
  };
}

const hnPage = z.object({
  hits: z.array(z.unknown()),
  nbPages: z.number().int().nonnegative().optional(),
});
const hnStory = z.object({
  objectID: z.string().regex(/^\d+$/),
  title: z.string().trim().min(1),
  created_at_i: epoch,
  points: z.number().min(10),
  story_text: z.string().nullish(),
  url: z.string().nullish(),
});

export const hackerNews: SourceAdapter = async (ctx, source, cursor) => {
  const previous = previousState(cursor);
  const floor = Math.max(nowSeconds() - 48 * HOUR, previous.through - 24 * HOUR);
  const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
  url.search = new URLSearchParams({
    tags: 'story',
    query: source.target,
    hitsPerPage: String(PAGE_SIZE),
    numericFilters: `created_at_i>=${floor},points>=10`,
  }).toString();
  const posts: RawSignal[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    url.searchParams.set('page', String(page));
    const response = hnPage.parse(JSON.parse(await readSource(ctx, url.href, 'application/json')));
    for (const item of response.hits) {
      const parsed = hnStory.safeParse(item);
      if (!parsed.success) continue;
      const p = parsed.data;
      if (p.created_at_i > nowSeconds() || (previous.through && p.created_at_i < floor)) continue;
      const link = httpsLink(p.url);
      posts.push({
        signalKey: p.objectID,
        sourceType: 'hn',
        sourceName: source.id,
        sourceUrl: `https://news.ycombinator.com/item?id=${p.objectID}`,
        title: p.title.slice(0, 500),
        rawText: (p.story_text || p.title).slice(0, 10000),
        candidateUrls: link ? [link] : [],
        publishedAt: new Date(p.created_at_i * 1000).toISOString(),
        engagement: p.points,
      });
    }
    if (!response.hits.length || page + 1 >= (response.nbPages ?? 1)) break;
  }
  return recentBatch(previous, cursor, posts);
};

export function redditConfigured() {
  return !!(
    process.env.REDDIT_ACCESS_TOKEN ||
    (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)
  );
}

const redditGrant = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().regex(/^bearer$/i),
});
let grant: { key: string; token: string; expiresAt: number } | undefined;

async function redditToken(signal: AbortSignal) {
  if (process.env.REDDIT_ACCESS_TOKEN) return process.env.REDDIT_ACCESS_TOKEN;
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Reddit credentials are missing');
  const key = sha256(JSON.stringify([id, secret]));
  if (grant?.key === key && grant.expiresAt > Date.now()) return grant.token;
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'user-agent': USER_AGENT,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Reddit OAuth HTTP ${response.status}`);
  }
  const parsed = redditGrant.safeParse(await response.json());
  if (!parsed.success) throw new Error('Invalid Reddit OAuth response');
  const data = parsed.data;
  grant = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
  return grant.token;
}

const redditPage = z.object({
  data: z.object({ children: z.array(z.unknown()), after: z.string().nullish() }),
});
const redditEntry = z.object({
  data: z.object({
    name: z.string().regex(/^t3_[a-z0-9]+$/),
    title: z.string().trim().min(1),
    permalink: z.string(),
    created_utc: epoch,
    score: z.number(),
    selftext: z.string().nullish(),
    url: z.string().nullish(),
  }),
});

export const reddit: SourceAdapter = async (ctx, source, cursor) => {
  if (!/^[a-z0-9_]{1,21}$/i.test(source.target)) throw new Error('Invalid subreddit');
  let token = await redditToken(ctx.signal);
  const previous = previousState(cursor);
  const floor = previous.through - 48 * HOUR;
  const url = new URL(`https://oauth.reddit.com/r/${source.target}/search`);
  url.search = new URLSearchParams({
    q: 'discount OR sale OR "free credits" OR "free API" OR lifetime OR promo',
    sort: 'new',
    t: 'week',
    restrict_sr: 'on',
    limit: String(PAGE_SIZE),
    raw_json: '1',
  }).toString();
  const posts: RawSignal[] = [];
  const pages = new Set<string>();
  let renewed = false;
  const request = () =>
    readSource(ctx, url.href, 'application/json', { authorization: `Bearer ${token}` });
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await request().catch(async (error) => {
      if (
        renewed ||
        process.env.REDDIT_ACCESS_TOKEN ||
        !(error instanceof SourceHttpError) ||
        error.status !== 401
      )
        throw error;
      renewed = true;
      if (grant?.token === token) grant = undefined;
      token = await redditToken(ctx.signal);
      return request();
    });
    const { data } = redditPage.parse(JSON.parse(body));
    let oldest = Infinity;
    for (const item of data.children) {
      const parsed = redditEntry.safeParse(item);
      if (!parsed.success) continue;
      const p = parsed.data.data;
      if (p.created_utc > nowSeconds()) continue;
      oldest = Math.min(oldest, p.created_utc);
      if (p.created_utc < floor || p.score < 5) continue;
      const match = /^\/r\/([a-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(p.permalink);
      if (match?.[1]?.toLowerCase() !== source.target.toLowerCase() || `t3_${match[2]}` !== p.name)
        continue;
      const link = httpsLink(`https://www.reddit.com${p.permalink}`);
      if (!link) continue;
      const body = p.selftext || p.title;
      const links = [
        p.url,
        ...(body.match(/https:\/\/[^\s<>")\]]+/g) ?? []).map((s) => s.replace(/[.,;!?]+$/, '')),
      ];
      const candidates = links
        .map((v) => httpsLink(v))
        .filter((u): u is string => !!u && u !== link);
      posts.push({
        signalKey: p.name,
        sourceType: 'reddit',
        sourceName: source.id,
        sourceUrl: link,
        title: p.title.slice(0, 500),
        rawText: body.slice(0, 10000),
        candidateUrls: [...new Set(candidates)].slice(0, 16),
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        engagement: p.score,
      });
    }
    const after = data.after;
    if (oldest < floor || !after || !/^t3_[a-z0-9]+$/.test(after) || pages.has(after)) break;
    pages.add(after);
    url.searchParams.set('after', after);
  }
  return recentBatch(previous, cursor, posts);
};

const bravePage = z.object({ web: z.object({ results: z.array(z.unknown()) }).optional() });
const braveHit = z.object({
  url: z.string(),
  title: z.string().trim().optional(),
  description: z.string().trim().optional(),
  page_age: z.string().optional(),
});

export async function searchWeb(ctx: Ctx, query: string, datedOnly = false) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  const now = Date.now();
  const floor = now - 48 * HOUR * 1000;
  const from = new Date(floor).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    q: query,
    count: '15',
    freshness: `${from}to${to}`,
  }).toString();
  const data = bravePage.parse(
    JSON.parse(
      await readSource(ctx, url.href, 'application/json', {
        'X-Subscription-Token': process.env.SEARCH_API_KEY || '',
      }),
    ),
  );
  const seen = new Set<string>();
  return (data.web?.results ?? []).flatMap((item) => {
    const parsed = braveHit.safeParse(item);
    if (!parsed.success) return [];
    const h = parsed.data;
    const link = httpsLink(h.url);
    if (!link || seen.has(link) || !(h.title || h.description)) return [];
    // Brave page_age can be a UTC timestamp without a timezone suffix.
    const timestamp = h.page_age?.replace(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/,
      '$1Z',
    );
    const at = timestamp !== undefined ? Date.parse(timestamp) : null;
    if (at !== null && (!Number.isFinite(at) || at < floor || at > now)) return [];
    if (datedOnly && (!h.title || at === null)) return [];
    seen.add(link);
    return [
      {
        url: link,
        title: h.title ?? '',
        description: h.description ?? '',
        page_age: at === null ? undefined : new Date(at).toISOString(),
      },
    ];
  });
}
export const webSearch: SourceAdapter = async (ctx, source, cursor) => {
  const hits = await searchWeb(ctx, source.target, true);
  // Undated URLs can help locate a merchant, but cannot establish a recent discovery.
  const signals: RawSignal[] = hits.map((h) => ({
    signalKey: sha256(h.url),
    sourceType: 'search',
    sourceName: source.id,
    sourceUrl: h.url,
    title: h.title.slice(0, 500),
    rawText: (h.description || h.title).slice(0, 10000),
    candidateUrls: [h.url],
    publishedAt: h.page_age ?? null,
  }));
  return recentBatch(previousState(cursor), cursor, signals);
};
