import { load } from 'cheerio';
import { sha256 } from '../util.ts';
import {
  httpsLink,
  type RawSignal,
  readSource,
  type SourceAdapter,
  type SourceConfig,
} from './types.ts';

/** V2EX's Atom alternate link ends in a changing comment anchor on the same topic. */
function feedLink(value: unknown, base?: string) {
  const link = httpsLink(value, base);
  if (!link) return null;
  const url = new URL(link);
  if (
    /(^|\.)v2ex\.com$/i.test(url.hostname) &&
    /^\/t\/\d+\/?$/.test(url.pathname) &&
    /^#reply\d*$/i.test(url.hash)
  ) {
    url.hash = '';
  }
  return url.href;
}

function statusId(link: string) {
  const url = new URL(link);
  if (!/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i.test(url.hostname)) return null;
  return /^\/(?:[\w]+|i\/web)\/status\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? null;
}

export function parseFeed(xml: string, source: SourceConfig, url = source.target): RawSignal[] {
  const $ = load(xml, { xml: true });
  if (!$('rss,feed,rdf\\:RDF').length) throw new Error('unrecognized RSS/Atom feed');
  return $('item,entry')
    .toArray()
    .flatMap((el) => {
      const item = $(el);
      let link = feedLink(
        item.children('link[rel="alternate"]').first().attr('href') ||
          item.children('link:not([rel])').first().attr('href') ||
          item.children('link').first().text(),
        url,
      );
      const title = item.children('title').text().trim();
      if (!link || !title) return [];
      const guid = item.children('guid,id').first().text().trim();
      const topicGuid = /^https:\/\/(?:www\.)?v2ex\.com\/t\/\d+\/?#reply\d*$/i.test(guid);
      let key = sha256((topicGuid ? feedLink(guid) : guid) || link);
      if (source.type === 'x') {
        const id = statusId(link);
        if (!id) return [];
        key = id;
        link = `https://x.com/i/status/${id}`;
      }
      const markup = item.children('description,summary,content,content\\:encoded').first().text();
      const html = load(markup);
      const links = html('a[href]')
        .toArray()
        .map((a) => feedLink(html(a).attr('href'), link))
        .filter((u): u is string => !!u);
      const time = Date.parse(item.children('pubDate,published,updated').first().text());
      return [
        {
          signalKey: key,
          sourceType: source.type,
          sourceName: source.id,
          sourceUrl: link,
          title: title.slice(0, 500),
          rawText: html.text().trim().slice(0, 10000),
          candidateUrls: [...new Set([link, ...links])].slice(0, 16),
          publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
        },
      ];
    });
}
export const rss: SourceAdapter = async (ctx, source, cursor) => {
  const url =
    source.type === 'x' ? new URL(source.target, process.env.RSSHUB_BASE_URL).href : source.target;
  const xml = await readSource(
    ctx,
    url,
    'application/rss+xml,application/atom+xml,application/xml,text/xml',
  );
  const signals = parseFeed(xml, source, url);
  // Feed-level timestamps and comment counts in V2EX link fragments do not change the offer.
  const next = sha256(
    JSON.stringify(signals.map((s) => [s.signalKey, s.title, s.rawText, s.candidateUrls])),
  );
  return { cursor: next, signals: cursor === next ? [] : signals };
};
