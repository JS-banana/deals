import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, createDb, type Db, eq, rawSignals, sql } from '@deals/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importSignals, parseSignalRow } from './import-signals.ts';
import { fingerprint } from './sources/sync.ts';
import { type Stats, sha256 } from './util.ts';

const input = {
  source: 'test-agent',
  sourceUrl: ' HTTPS://COMMUNITY.example:443/posts/123 ',
  title: '年付优惠',
  quote: '新用户年付减 20%',
  merchantUrls: ['https://merchant.example/pricing'],
};
const now = Date.parse('2026-11-27T10:00:00Z');
const parse = (fields: object = {}) =>
  parseSignalRow(JSON.stringify({ ...input, ...fields }), now).signal;

describe('parseSignalRow', () => {
  it('normalizes URLs, cleans and deduplicates merchants, and maps the source and quote', () => {
    const signal = parse({
      merchantUrls: [
        'https://MERCHANT.example:443/pricing?utm_source=community&plan=pro',
        'https://merchant.example/pricing?plan=pro&ref=post',
      ],
      publishedAt: '2026-11-27T17:00:00+08:00',
      engagement: 0,
    });
    expect(signal).toEqual({
      signalKey: sha256('https://community.example/posts/123'),
      sourceType: 'user_tip',
      sourceName: 'agent:test-agent',
      sourceUrl: 'https://community.example/posts/123',
      title: input.title,
      rawText: input.quote,
      candidateUrls: ['https://merchant.example/pricing?plan=pro'],
      publishedAt: '2026-11-27T09:00:00.000Z',
      engagement: 0,
    });
  });

  it('uses the same fingerprint as sync for the mapped signal', () => {
    const row = parseSignalRow(JSON.stringify(input));
    expect(row).toMatchObject({
      sourceId: 'agent-collected',
      signalKey: row.signal.signalKey,
      fingerprint: fingerprint(row.signal),
    });
  });

  it.each([
    'not a URL',
    'http://community.example/',
    'https://127.0.0.1/',
    'https://u:p@example.com/',
  ])('rejects unsuitable source URLs (%s)', (sourceUrl) =>
    expect(() => parse({ sourceUrl })).toThrow('sourceUrl'),
  );

  it('drops invalid merchant URLs, social domains, and their subdomains', () => {
    const domains = [
      'reddit.com',
      'redd.it',
      'news.ycombinator.com',
      'x.com',
      'twitter.com',
      't.co',
    ];
    const merchantUrl = 'https://notreddit.com/pricing';
    for (const host of domains) {
      const invalid = [
        'no URL',
        'http://merchant.example/',
        `https://${host}/`,
        `https://a.${host}./`,
      ];
      expect(parse({ merchantUrls: [...invalid, merchantUrl] }).candidateUrls).toEqual([
        merchantUrl,
      ]);
      expect(() => parse({ merchantUrls: invalid })).toThrow(
        'merchantUrls has no eligible HTTPS URL',
      );
    }
  });

  it.each([
    { merchantUrls: [] },
    { merchantUrls: Array(9).fill(input.merchantUrls[0]) },
    { merchantUrls: [42] },
  ])('rejects malformed merchant arrays ($merchantUrls)', ({ merchantUrls }) => {
    expect(() => parse({ merchantUrls })).toThrow('merchantUrls');
  });

  it.each([null, '2026-11-28T10:00:00Z', '2026-02-30T10:00:00Z', '11/26/2026', 'invalid'])(
    'drops unusable publication dates (%s)',
    (publishedAt) => expect(parse({ publishedAt }).publishedAt).toBeNull(),
  );

  it('rejects a blank title or quote', () => {
    expect(() => parse({ title: ' ' })).toThrow('title');
    expect(() => parse({ quote: '\n\t' })).toThrow('quote');
  });

  it('rejects text that PostgreSQL JSONB cannot store', () => {
    expect(() => parse({ title: 'deal\0' })).toThrow('title');
    expect(() => parse({ quote: '\uD800' })).toThrow('quote');
    expect(parse({ quote: '✨ 🥳' }).rawText).toBe('✨ 🥳');
  });
});

describe('importSignals', () => {
  let directory: string | undefined;
  let file: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(process.cwd(), '.import-signals-test-'));
    file = join(directory, 'input.jsonl');
  });
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function context(db?: Db) {
    const stats: Stats = {};
    const logs: string[] = [];
    return {
      file,
      dryRun: db === undefined,
      get db() {
        if (!db) throw new Error('dry run accessed the database');
        return db;
      },
      stats,
      signal: new AbortController().signal,
      log: (message: string) => logs.push(message),
      logs,
    };
  }

  it('counts valid and invalid lines without querying the database or logging line content', async () => {
    const ctx = context();
    const line = JSON.stringify(input);
    await writeFile(file, `${line}\r\n{private notes\r\n${line}`);
    await importSignals(ctx);
    expect(ctx.stats).toEqual({ valid: 2, invalid: 1, inserted: 0, duplicates: 0 });
    expect(ctx.logs).toEqual(['line 2: invalid JSON']);
  });

  it('accepts 64 KB before CRLF and rejects a longer line by byte length', async () => {
    const line = JSON.stringify(input);
    const padded = line.padEnd(line.length + 64 * 1024 - Buffer.byteLength(line));
    await writeFile(file, `${padded}\r\n`);
    const ctx = context();
    await importSignals(ctx);
    expect(ctx.stats.valid).toBe(1);

    await writeFile(file, `${padded.slice(0, -1)}é`);
    await expect(importSignals(context())).rejects.toThrow('line 1 exceeds 64 KB');
  });

  it('fails when no line is valid', async () => {
    await writeFile(file, '{\n  "pretty": true\n}\n');
    await expect(importSignals(context())).rejects.toThrow('no valid line');
  });

  it('counts blank lines towards the line limit', async () => {
    await writeFile(file, `${'\n'.repeat(2000)}${JSON.stringify(input)}\n`);
    await expect(importSignals(context())).rejects.toThrow('file exceeds 2000 lines');
  });

  it('rejects files over 2000 lines', async () => {
    await writeFile(file, `${JSON.stringify(input)}\n`.repeat(2001));
    await expect(importSignals(context())).rejects.toThrow('file exceeds 2000 lines');
  });

  const databaseUrl = process.env.REVIEW_TEST_DATABASE_URL;
  it.skipIf(!databaseUrl)(
    'stores the shared sync fingerprint and counts conflicts across batches',
    async () => {
      const db = createDb(databaseUrl);
      const source = randomUUID();
      const rows = Array.from({ length: 101 }, (_, index) =>
        JSON.stringify({
          ...input,
          source,
          sourceUrl: `https://community.example/${source}/${index}`,
        }),
      );
      const [first] = rows;
      if (!first) throw new Error('missing test signal');
      const scope = and(
        eq(rawSignals.sourceId, 'agent-collected'),
        sql`signal->>'sourceName' = ${`agent:${source}`}`,
      );
      try {
        await writeFile(file, [...rows, first].join('\n'));
        const ctx = context(db);
        await importSignals(ctx);
        expect(ctx.stats).toEqual({ valid: 102, invalid: 0, inserted: 101, duplicates: 1 });
        const { signal } = parseSignalRow(first);
        const stored = await db.select().from(rawSignals).where(scope);
        expect(stored).toHaveLength(101);
        expect(stored.find((row) => row.signalKey === signal.signalKey)).toMatchObject({
          fingerprint: fingerprint(signal),
          signal,
          processedAt: null,
        });

        await importSignals(ctx);
        expect(ctx.stats).toEqual({ valid: 102, invalid: 0, inserted: 0, duplicates: 102 });
      } finally {
        try {
          await db.delete(rawSignals).where(scope);
        } finally {
          await db.$client.end();
        }
      }
    },
  );
});
