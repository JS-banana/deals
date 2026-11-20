import type { DealEvent, Product } from '@deals/core';
import {
  deals as dealsTable,
  eq,
  listEvents,
  products as productsTable,
  syncState,
  toProduct,
} from '@deals/db';
import type { Ctx } from './runtime.ts';
import { today } from './runtime.ts';
import { errorMessage } from './util.ts';
import { pickEvent } from './verify.ts';

export const UPSTREAM_REPO = 'trungdq88/Awesome-Black-Friday-Cyber-Monday';
const STATE_KEY = 'upstream:awesome-bfcm';
const DEFAULT_LIMIT = 15;
/** An entry whose extraction keeps failing is dropped after this many tries. */
const MAX_ATTEMPTS = 2;

export interface UpstreamEntry {
  /** Stable identity (normalized name + host); survives line shifts between commits. */
  key: string;
  name: string;
  url: string;
  description: string;
  offer: string;
  /** Heading path, e.g. "Developer Tools / Developer macOS Apps". */
  section: string;
  /** 1-based README line, for the permalink. */
  line: number;
  /** The full source row as written in the README. */
  raw: string;
}

const EMOJI = /\p{Extended_Pictographic}|‍|️|[\u{1f3fb}-\u{1f3ff}]/gu;
const LINK = /\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)[^)]*\)/;
const SKIPPED_SECTIONS = /what'?s new|sponsored|table of contents/i;
/** Hosts that say nothing about which product an entry is. */
const SHARED_HOSTS = new Set([
  'apps.apple.com',
  'play.google.com',
  'chromewebstore.google.com',
  'chrome.google.com',
  'apps.microsoft.com',
  'microsoft.com',
  'github.com',
  'gitlab.com',
  'gumroad.com',
  'lemonsqueezy.com',
  'producthunt.com',
  'setapp.com',
  'appsumo.com',
  'itch.io',
  'x.com',
  'twitter.com',
  'youtube.com',
  'medium.com',
]);

const plain = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(EMOJI, '')
    .replace(/[*~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeName = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const isSharedHost = (host: string | null) =>
  host === null || [...SHARED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));

export function entryKey(name: string, url: string): string {
  return `${normalizeName(name)}|${hostOf(url) ?? ''}`;
}

/** Drop tracking parameters and upgrade to https so the URL is what a shopper should open. */
export function cleanMerchantUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol === 'http:') url.protocol = 'https:';
  for (const param of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(param) || /^(ref|via|fbclid|gclid|ref_src)$/i.test(param)) {
      url.searchParams.delete(param);
    }
  }
  return url.href.replace(/\?$/, '');
}

export const permalink = (sha: string, line: number) =>
  `https://github.com/${UPSTREAM_REPO}/blob/${sha}/README.md#L${line}`;

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());

/**
 * Entries from the README: rows of the category tables (header "Name | Description | ...") and,
 * for other layouts, `- [Name](url) - description` list items. Sections that are not deal
 * lists (intro, sponsors, table of contents) are skipped.
 */
export function parseReadme(markdown: string): UpstreamEntry[] {
  const entries: UpstreamEntry[] = [];
  const seen = new Set<string>();
  const headings: string[] = [];
  let skipSection = false;
  let columns: { name: number; description: number; offer: number } | null = null;

  const add = (entry: Omit<UpstreamEntry, 'key' | 'section'>) => {
    const key = entryKey(entry.name, entry.url);
    if (!entry.name || seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, key, section: headings.filter(Boolean).join(' / ') });
  };

  for (const [index, rawLine] of markdown.split('\n').entries()) {
    const line = rawLine.replace(/\r$/, '');
    const line1 = index + 1;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length;
      headings.length = Math.max(0, level - 2);
      if (level >= 2) headings[level - 2] = plain(heading[2]);
      if (level === 2) skipSection = SKIPPED_SECTIONS.test(heading[2]);
      columns = null;
      continue;
    }
    if (skipSection) continue;

    if (line.trimStart().startsWith('|')) {
      const cells = splitRow(line);
      const labels = cells.map((c) => c.toLowerCase());
      if (labels.includes('name')) {
        const find = (re: RegExp) => labels.findIndex((l) => re.test(l));
        columns = {
          name: labels.indexOf('name'),
          description: find(/description/),
          offer: find(/discount|terms|deal/),
        };
        continue;
      }
      if (!columns || cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;
      const link = LINK.exec(cells[columns.name] ?? '');
      if (!link?.[1] || !link[2]) continue;
      const cell = (i: number) =>
        i >= 0 ? (cells[i] ?? '').replace(/<br\s*\/?>/gi, ' ').trim() : '';
      add({
        name: plain(link[1]),
        url: link[2],
        description: cell(columns.description),
        offer: cell(columns.offer),
        line: line1,
        raw: line.trim(),
      });
      continue;
    }
    columns = null;

    const item =
      /^\s*[-*+]\s+\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)[^)]*\)\s*(?:[-–—:]\s*)?(.*)$/.exec(line);
    if (item?.[1] && item[2]) {
      add({
        name: plain(item[1]),
        url: item[2],
        description: (item[3] ?? '').trim(),
        offer: '',
        line: line1,
        raw: line.trim(),
      });
    }
  }
  return entries;
}

export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface CatalogProduct extends Product {
  id: number;
  /** Hosts of the product website and its deals' merchant URLs, shared marketplaces excluded. */
  hosts: Set<string>;
  inTargetEvent: boolean;
}

export interface Catalog {
  products: CatalogProduct[];
  events: Array<DealEvent & { id: number }>;
  /** Event used to decide whether an entry is already covered. */
  targetEvent: string;
}

/** The catalog product an upstream entry refers to: same name, slug or merchant host. */
export function findKnown(catalog: Catalog, entry: Pick<UpstreamEntry, 'name' | 'url'>) {
  const host = hostOf(entry.url);
  const name = normalizeName(entry.name);
  return catalog.products.find(
    (p) =>
      normalizeName(p.name) === name ||
      normalizeName(p.slug) === name ||
      (host !== null && !isSharedHost(host) && p.hosts.has(host)),
  );
}

interface State {
  sha: string | null;
  processed: string[];
  attempts: Record<string, number>;
}

async function fetchText(
  url: string,
  ctx: Ctx,
  headers: Record<string, string> = {},
): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'DealIndexBot/1.0 (+https://deals.laifuyou.com/about)', ...headers },
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

/** HEAD commit of the list: GitHub API first, the public Atom feed when the API is rate limited. */
async function headSha(ctx: Ctx): Promise<string> {
  const headers: Record<string, string> = { accept: 'application/vnd.github.sha' };
  if (ctx.config.githubToken) headers.authorization = `Bearer ${ctx.config.githubToken}`;
  try {
    const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/HEAD`;
    const sha = (await fetchText(url, ctx, headers)).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch (error) {
    ctx.log(`GitHub API unavailable (${errorMessage(error)}), using the Atom feed`);
  }
  const feed = await fetchText(`https://github.com/${UPSTREAM_REPO}/commits/HEAD.atom`, ctx);
  const sha = /Grit::Commit\/([0-9a-f]{40})/.exec(feed)?.[1];
  if (!sha) throw new Error('could not determine the upstream HEAD commit');
  return sha;
}

async function loadCatalog(ctx: Ctx): Promise<Catalog> {
  const [productRows, dealRows, events] = await Promise.all([
    ctx.db.select().from(productsTable),
    ctx.db
      .select({
        productId: dealsTable.productId,
        eventId: dealsTable.eventId,
        merchantUrl: dealsTable.merchantUrl,
      })
      .from(dealsTable),
    listEvents(ctx.db),
  ]);
  const targetSlug = pickEvent(events, { startsOn: null, endsOn: null }, today());
  const targetId = events.find((e) => e.slug === targetSlug)?.id;
  return {
    events,
    targetEvent: targetSlug,
    products: productRows.map((row) => {
      const own = dealRows.filter((d) => d.productId === row.id);
      const hosts = [row.website, ...own.map((d) => d.merchantUrl)]
        .map((url) => (url ? hostOf(url) : null))
        .filter((host): host is string => host !== null && !isSharedHost(host));
      return {
        ...toProduct(row),
        hosts: new Set(hosts),
        inTargetEvent: own.some((d) => d.eventId === targetId),
      };
    }),
  };
}

export interface Discovery {
  sha: string;
  catalog: Catalog;
  /** New entries, capped at the run limit, in README order. */
  candidates: UpstreamEntry[];
  /** Entries skipped without extraction because the target event already has the product. */
  existing: number;
  /** New entries beyond the cap, left for later runs. */
  backlog: number;
  done(key: string): void;
  failed(key: string): number;
  save(): Promise<void>;
}

/**
 * Read the upstream list and work out which entries are new since the last run. Entries are
 * "processed" once they produced a proposal or a final skip; the seeded catalog counts as
 * processed because its products already have deals in the target event.
 */
export async function discover(ctx: Ctx): Promise<Discovery> {
  const limit = ctx.limit ?? DEFAULT_LIMIT;
  const sha = await headSha(ctx);
  const markdown = await fetchText(
    `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${sha}/README.md`,
    ctx,
  );
  const entries = parseReadme(markdown);
  const [row] = await ctx.db.select().from(syncState).where(eq(syncState.key, STATE_KEY));
  const saved = (row?.value ?? {}) as Partial<State>;
  const processed = new Set(saved.processed ?? []);
  const attempts = saved.attempts ?? {};
  ctx.log(
    `upstream ${sha.slice(0, 7)} (${saved.sha ? `last run ${saved.sha.slice(0, 7)}` : 'first run'}): ` +
      `${entries.length} entries, ${processed.size} processed`,
  );

  const catalog = await loadCatalog(ctx);
  const candidates: UpstreamEntry[] = [];
  let existing = 0;
  let backlog = 0;
  for (const entry of entries) {
    if (processed.has(entry.key)) continue;
    if (findKnown(catalog, entry)?.inTargetEvent) {
      processed.add(entry.key);
      existing++;
    } else if (candidates.length < limit) candidates.push(entry);
    else backlog++;
  }

  return {
    sha,
    catalog,
    candidates,
    existing,
    backlog,
    done: (key) => void processed.add(key),
    failed(key) {
      const count = (attempts[key] ?? 0) + 1;
      attempts[key] = count;
      if (count >= MAX_ATTEMPTS) processed.add(key);
      return count;
    },
    async save() {
      const value: State = { sha, processed: [...processed], attempts };
      await ctx.db
        .insert(syncState)
        .values({ key: STATE_KEY, value })
        .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
    },
  };
}
