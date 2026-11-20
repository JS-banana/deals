import { load } from 'cheerio';
import { createLimiter, errorMessage, sha256, sleep } from './util.ts';

export const USER_AGENT = 'DealIndexBot/1.0 (+https://deals.laifuyou.com/about)';

const TIMEOUT_MS = 20_000;
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

/** Reject loopback, private and link-local literals. Does not defend against DNS rebinding. */
export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('unsupported-protocol');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const privateV6 = host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    privateV4 ||
    privateV6
  )
    throw new Error('non-public-host');
  return url;
}

export interface RawResponse {
  status: number;
  url: string;
  contentType: string;
  body: Uint8Array;
  /** True when the body hit `maxBytes` and was cut. */
  truncated: boolean;
}

export interface Fetcher {
  raw(url: string, opts: { accept: string; maxBytes: number }): Promise<RawResponse>;
  page(url: string): Promise<Page>;
}

/** HTTP access with a shared concurrency cap and a minimum delay between hits on the same host. */
export function createFetcher(signal: AbortSignal, concurrency = 3, hostDelayMs = 1000): Fetcher {
  const limit = createLimiter(concurrency);
  const nextSlot = new Map<string, number>();

  async function throttle(host: string) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + hostDelayMs);
    await sleep(at - now, signal);
  }

  async function raw(
    url: string,
    opts: { accept: string; maxBytes: number },
  ): Promise<RawResponse> {
    const target = assertPublicUrl(url);
    return limit(async () => {
      await throttle(target.hostname);
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
      const response = await fetch(target, {
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept,
          'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.5',
        },
        signal: timeout,
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
          if (size > opts.maxBytes) {
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
      const body = new Uint8Array(Math.min(size, opts.maxBytes));
      let offset = 0;
      for (const chunk of chunks) {
        const part = chunk.subarray(0, Math.max(0, body.length - offset));
        body.set(part, offset);
        offset += part.length;
      }
      return {
        status: response.status,
        url: response.url || target.href,
        contentType: response.headers.get('content-type') ?? '',
        body,
        truncated,
      };
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
