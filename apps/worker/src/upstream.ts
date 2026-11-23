import type { Deal, DealEvent, Product } from '@deals/core';
import { deals as dealsTable, listEvents, products as productsTable, toProduct } from '@deals/db';
import { load } from 'cheerio';
import type { Ctx } from './runtime.ts';
import { today } from './runtime.ts';
import { pickEvent } from './verify.ts';

export const UPSTREAM_REPO = 'trungdq88/Awesome-Black-Friday-Cyber-Monday';
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
export function parseReadme(markdown: string, distinctOffers = false): UpstreamEntry[] {
  const entries: UpstreamEntry[] = [];
  const seen = new Set<string>();
  const headings: string[] = [];
  const sections: Array<{ line: number; label: string; skip: boolean }> = [];
  let skipSection = false;
  let fence = '';
  let columns: { name: number; description: number; offer: number } | null = null;

  const add = (
    entry: Omit<UpstreamEntry, 'key' | 'section'>,
    section = headings.filter(Boolean).join(' / '),
  ) => {
    let cleaned: string;
    try {
      cleaned = cleanMerchantUrl(entry.url);
    } catch {
      return;
    }
    const key = distinctOffers
      ? JSON.stringify([entryKey(entry.name, entry.url), cleaned, entry.offer || entry.description])
      : entryKey(entry.name, entry.url);
    if (!entry.name || seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, key, section });
  };

  for (const [index, rawLine] of markdown.split('\n').entries()) {
    const line = rawLine.replace(/\r$/, '');
    const line1 = index + 1;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? '' : marker;
      sections.push({
        line: line1,
        label: headings.filter(Boolean).join(' / '),
        skip: !!fence || skipSection,
      });
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length;
      headings.length = Math.max(0, level - 2);
      if (level >= 2) headings[level - 2] = plain(heading[2]);
      if (level === 2) skipSection = SKIPPED_SECTIONS.test(heading[2]);
      sections.push({
        line: line1,
        label: headings.filter(Boolean).join(' / '),
        skip: skipSection,
      });
      columns = null;
      continue;
    }
    if (skipSection) continue;

    if (line.trimStart().startsWith('|')) {
      const cells = splitRow(line);
      const labels = cells.map((c) => plain(c).toLowerCase());
      if (labels.includes('name')) {
        const find = (re: RegExp) => labels.findIndex((l) => re.test(l));
        columns = {
          name: labels.indexOf('name'),
          description: find(/description/),
          offer: find(/discount|terms|deal|offer/),
        };
        continue;
      }
      if (
        labels.includes('provider') &&
        labels.includes('free models') &&
        labels.includes('get api key')
      ) {
        columns = { name: labels.indexOf('provider'), description: -1, offer: -2 };
        continue;
      }
      if (columns?.offer === -2) {
        const href = load(cells.at(-1) ?? '')('a[href]')
          .first()
          .attr('href');
        if (href && /^https:\/\//.test(href))
          add({
            name: plain(cells[columns.name] ?? ''),
            url: href,
            description: 'Free API access',
            offer: '',
            line: line1,
            raw: line.trim(),
          });
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
        description:
          cell(columns.description) ||
          plain(
            (cells[columns.name] ?? '')
              .split(/<br\s*\/?>/i)
              .slice(1)
              .join(' '),
          ),
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
  // Some curated lists are HTML tables embedded in Markdown. Skip sponsor tables without offer columns.
  const html = load(markdown, { sourceCodeLocationInfo: true });
  for (const table of html('table').toArray()) {
    const start = table.sourceCodeLocation?.startLine ?? 1;
    const section = sections.findLast((s) => s.line <= start);
    if (section?.skip) continue;
    const headers = html(table)
      .find('th')
      .toArray()
      .map((th) => html(th).text().trim().toLowerCase());
    const app = headers.indexOf('app'),
      offer = headers.indexOf('offer');
    if (app < 0 || offer < 0) continue;
    for (const tr of html(table).find('tr').toArray()) {
      const cells = html(tr).children('td');
      const link = cells.eq(app).find('a[href]').first();
      const url = link.attr('href');
      if (!url || !/^https?:\/\//.test(url)) continue;
      add(
        {
          name: link.text().trim(),
          url,
          description: cells.eq(headers.indexOf('description')).text().trim(),
          offer: cells.eq(offer).text().trim(),
          line: tr.sourceCodeLocation?.startLine ?? 1,
          raw: cells
            .toArray()
            .map((td) => html(td).text().trim())
            .join(' | '),
        },
        section?.label ?? '',
      );
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
  offers?: Array<
    Pick<
      Deal,
      'offerKey' | 'offerType' | 'billing' | 'code' | 'merchantUrl' | 'plan' | 'priceAmount'
    > & { eventId: number }
  >;
}

export interface Catalog {
  products: CatalogProduct[];
  events: Array<DealEvent & { id: number }>;
  /** Event used to decide whether an entry is already covered. */
  targetEvent: string;
}

/** The catalog product an upstream entry refers to: same name, slug or merchant host. */
export function findKnown(
  catalog: Catalog,
  entry: Pick<UpstreamEntry, 'name' | 'url'>,
  matchHost = true,
) {
  const host = hostOf(entry.url);
  const name = normalizeName(entry.name);
  const exact = catalog.products.find(
    (p) => normalizeName(p.name) === name || normalizeName(p.slug) === name,
  );
  if (exact || !matchHost || !host || isSharedHost(host)) return exact;
  const matches = catalog.products.filter((p) => p.hosts.has(host));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function loadCatalog(ctx: Ctx): Promise<Catalog> {
  const [productRows, dealRows, events] = await Promise.all([
    ctx.db.select().from(productsTable),
    ctx.db
      .select({
        productId: dealsTable.productId,
        eventId: dealsTable.eventId,
        offerKey: dealsTable.offerKey,
        plan: dealsTable.plan,
        priceAmount: dealsTable.priceAmount,
        offerType: dealsTable.offerType,
        code: dealsTable.code,
        billing: dealsTable.billing,
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
        offers: own,
        inTargetEvent: own.some((d) => d.eventId === targetId),
      };
    }),
  };
}
