import { lookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { load } from 'cheerio';
import { Client, fetch, type Response } from 'undici';
import { createLimiter, errorMessage, sha256, sleep } from './util.ts';

export const USER_AGENT = 'DealIndexBot/1.0 (+https://deals.laifuyou.com/about)';

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
/** Below this many characters of body text the page is treated as JS-rendered. */
const MIN_TEXT_CHARS = 200;

export interface Icon {
  href: string;
  rel: string;
  /** Edge length in px of the largest declared size; 0 when unknown. */
  size: number;
  type: string | null;
}

export interface Page {
  /** Final URL after redirects. */
  url: string;
  status: number | null;
  title: string | null;
  text: string;
  hash: string | null;
  icons: Icon[];
  error: string | null;
}

export function normalizeText(text: string): string {
  const lines: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
    if (line && line !== lines[lines.length - 1]) lines.push(line);
  }
  return lines.join('\n');
}

const BLOCKS =
  'p,div,section,article,header,footer,main,nav,aside,ul,ol,li,h1,h2,h3,h4,h5,h6,tr,table,form,blockquote,pre,dl,dt,dd,figure,figcaption,details,summary,fieldset,hr,option';

/** Readable text, title and icon candidates from raw HTML. Pure; no network. */
export function extractPage(
  html: string,
  baseUrl: string,
): { title: string | null; text: string; bodyChars: number; icons: Icon[] } {
  const $ = load(html);
  const title = normalizeText($('title').first().text()) || null;
  const meta = (selector: string) => ($(selector).first().attr('content') ?? '').trim();
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');

  const icons: Icon[] = [];
  $('link[rel][href]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    if (!/(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut|mask-icon)(\s|$)/.test(rel)) return;
    let href: string;
    try {
      href = new URL($(el).attr('href') ?? '', baseUrl).href;
    } catch {
      return;
    }
    if (!/^https?:/.test(href)) return;
    const sizes = [...($(el).attr('sizes') ?? '').matchAll(/(\d+)x(\d+)/gi)].map((m) =>
      Number(m[1]),
    );
    icons.push({
      href,
      rel: rel.includes('apple-touch-icon') ? 'apple-touch-icon' : 'icon',
      size: sizes.length ? Math.max(...sizes) : 0,
      type: $(el).attr('type')?.toLowerCase() ?? null,
    });
  });

  $('script,style,noscript,svg,template,iframe,canvas').remove();
  const body = $('body');
  body.find('br').replaceWith('\n');
  body.find(BLOCKS).each((_, el) => {
    $(el).before('\n').after('\n');
  });
  body.find('td,th').after(' | ');
  const bodyText = normalizeText(body.text());

  const head = [title, description].filter(Boolean).join('\n');
  const text = normalizeText(`${head}\n${bodyText}`).slice(0, MAX_TEXT_CHARS);
  return { title, text, bodyChars: bodyText.length, icons };
}

// Special-use, multicast and reserved networks from the IANA address registries.
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return (
    family === 6 &&
    !address.includes('%') &&
    globalV6.check(address, 'ipv6') &&
    !blocked.check(address, 'ipv6')
  );
}

/** Reject unsafe protocols, local names and non-public IP literals before opening a socket. */
export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('unsupported-protocol');
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (/(^|\.)(localhost|local|internal)$/.test(host) || (isIP(host) && !isPublicAddress(host)))
    throw new Error('non-public-host');
  return url;
}

/** Node connects to these exact answers while using the original URL for Host, SNI and TLS. */
function publicSocketLookup(signal: AbortSignal): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true }, (err, answers) => {
      if (signal.aborted) return callback(signal.reason, '');
      if (err) return callback(err, '');
      const first = answers[0];
      if (
        !first ||
        answers.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))
      ) {
        return callback(new Error('non-public-host'), '');
      }
      if (options.all) return callback(null, answers);
      callback(null, first.address, first.family);
    });
  };
}

export interface RawResponse {
  status: number;
  url: string;
  contentType: string;
  body: Uint8Array;
  /** True when the body hit `maxBytes` and was cut. */
  truncated: boolean;
}

export interface FetchOptions {
  accept: string;
  maxBytes: number;
  headers?: Record<string, string>;
}

export interface Fetcher {
  raw(url: string, opts: FetchOptions): Promise<RawResponse>;
  page(url: string): Promise<Page>;
}

async function readBody(response: Response, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const part = value.subarray(0, maxBytes - size);
        chunks.push(part);
        size += part.length;
        if (part.length < value.length) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  return { body: Buffer.concat(chunks, size), truncated };
}

/** HTTP access with a shared concurrency cap and a minimum delay between hits on the same host. */
export function createFetcher(signal: AbortSignal, concurrency = 3, hostDelayMs = 1000): Fetcher {
  const limit = createLimiter(concurrency);
  const nextSlot = new Map<string, number>();

  async function throttle(host: string, timeout: AbortSignal) {
    timeout.throwIfAborted();
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + hostDelayMs);
    await sleep(at - now, timeout);
    timeout.throwIfAborted();
  }

  async function raw(url: string, opts: FetchOptions): Promise<RawResponse> {
    let target = assertPublicUrl(url);
    let trustedHeaders = opts.headers;
    return limit(async () => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
      for (let hops = 0; ; hops++) {
        await throttle(target.hostname.replace(/\.$/, ''), timeout);
        const client = new Client(target.origin, {
          autoSelectFamily: true,
          connect: { lookup: publicSocketLookup(timeout) },
        });
        try {
          const response = await fetch(target, {
            dispatcher: client,
            redirect: 'manual',
            headers: {
              ...trustedHeaders,
              'user-agent': USER_AGENT,
              accept: opts.accept,
              'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.5',
            },
            signal: timeout,
          });
          const location = response.headers.get('location');
          if (location !== null && REDIRECT_STATUSES.has(response.status)) {
            await response.body?.cancel();
            if (hops === MAX_REDIRECTS) throw new Error('too-many-redirects');
            const next = assertPublicUrl(new URL(location, target).href);
            if (next.origin !== target.origin) trustedHeaders = undefined;
            target = next;
            continue;
          }
          return {
            status: response.status,
            url: response.url || target.href,
            contentType: response.headers.get('content-type') ?? '',
            ...(await readBody(response, opts.maxBytes)),
          };
        } finally {
          await client.destroy();
        }
      }
    });
  }

  async function page(url: string): Promise<Page> {
    const failed = (status: number | null, error: string, finalUrl = url): Page => ({
      url: finalUrl,
      status,
      title: null,
      text: '',
      hash: null,
      icons: [],
      error,
    });
    let res: RawResponse;
    try {
      res = await raw(url, { accept: 'text/html,application/xhtml+xml', maxBytes: MAX_HTML_BYTES });
    } catch (error) {
      if (signal.aborted) throw error;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError') return failed(null, 'timeout');
      const cause = error instanceof Error ? error.cause : undefined;
      const detail = cause instanceof Error ? cause.message : errorMessage(error);
      return failed(null, `network: ${detail}`.slice(0, 200));
    }
    if (res.status >= 400) return failed(res.status, `http-${res.status}`, res.url);
    if (!/html|xml/i.test(res.contentType)) {
      return failed(res.status, `not-html: ${res.contentType.slice(0, 60)}`, res.url);
    }
    const charset = /charset=["']?([\w-]+)/i.exec(res.contentType)?.[1];
    let html: string;
    try {
      html = new TextDecoder(charset ?? 'utf-8').decode(res.body);
    } catch {
      html = new TextDecoder('utf-8').decode(res.body);
    }
    const parsed = extractPage(html, res.url);
    const empty = parsed.bodyChars < MIN_TEXT_CHARS;
    return {
      url: res.url,
      status: res.status,
      title: parsed.title,
      text: parsed.text,
      hash: empty ? null : sha256(parsed.text),
      icons: parsed.icons,
      error: empty ? 'empty-text' : null,
    };
  }

  return { raw, page };
}
