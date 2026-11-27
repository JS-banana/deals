import { readFile, stat } from 'node:fs/promises';
import { type RawSignal, rawSignals } from '@deals/db';
import { z } from 'zod';
import type { Ctx } from './runtime.ts';
import { fingerprint } from './sources/sync.ts';
import { httpsLink } from './sources/types.ts';
import { cleanMerchantUrl } from './upstream.ts';
import { errorMessage, sha256 } from './util.ts';

const MAX_LINES = 2000;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SOURCE_ID = 'agent-collected';
const socialHost = /(^|\.)(reddit\.com|redd\.it|news\.ycombinator\.com|x\.com|twitter\.com|t\.co)$/;
const instant = z.iso.datetime({ offset: true });
// PostgreSQL JSONB rejects NUL and unpaired surrogates, even when escaped in JSON.
const storableText = (value: string) =>
  value.trim() !== '' && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value);
const inputSchema = z.object({
  source: z.string().regex(/^[a-z0-9-]{1,40}$/),
  sourceUrl: z.string(),
  title: z.string().max(500).refine(storableText, 'is blank or has unsupported characters'),
  quote: z.string().max(10_000).refine(storableText, 'is blank or has unsupported characters'),
  merchantUrls: z.array(z.string()).min(1).max(8),
  publishedAt: z.string().nullish(),
  engagement: z.number().optional(),
});

export function parseSignalRow(line: string, now = Date.now()) {
  let input: unknown;
  try {
    input = JSON.parse(line);
  } catch {
    throw new Error('invalid JSON');
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'invalid input',
    );
  }
  const { source, title, quote, merchantUrls, publishedAt, engagement } = parsed.data;
  const sourceUrl = httpsLink(parsed.data.sourceUrl);
  if (!sourceUrl) throw new Error('sourceUrl must be a public HTTPS URL');

  const candidates = new Set<string>();
  for (const value of merchantUrls) {
    const link = httpsLink(value);
    if (!link) continue;
    const url = cleanMerchantUrl(link);
    if (!socialHost.test(new URL(url).hostname.replace(/\.$/, ''))) candidates.add(url);
  }
  if (!candidates.size) throw new Error('merchantUrls has no eligible HTTPS URL');

  const timestamp = instant.safeParse(publishedAt);
  const time = timestamp.success ? Date.parse(timestamp.data) : NaN;
  const signal: RawSignal = {
    signalKey: sha256(sourceUrl),
    sourceType: 'user_tip',
    sourceName: `agent:${source}`,
    sourceUrl,
    title,
    rawText: quote,
    candidateUrls: [...candidates],
    publishedAt: time <= now ? new Date(time).toISOString() : null,
    ...(engagement === undefined ? {} : { engagement }),
  };
  return {
    sourceId: SOURCE_ID,
    signalKey: signal.signalKey,
    fingerprint: fingerprint(signal),
    signal,
  };
}

export async function importSignals(
  ctx: Pick<Ctx, 'file' | 'dryRun' | 'db' | 'stats' | 'signal' | 'log'>,
): Promise<void> {
  if (!ctx.file) throw new Error('import-signals requires --file <path>');
  const counts = { valid: 0, invalid: 0, inserted: 0, duplicates: 0 };
  Object.assign(ctx.stats, counts);
  const rows: Array<typeof rawSignals.$inferInsert> = [];
  const now = Date.now();
  if ((await stat(ctx.file)).size > MAX_FILE_BYTES) throw new Error('file exceeds 8 MB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(
    await readFile(ctx.file, { signal: ctx.signal }),
  );
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > MAX_LINES) throw new Error(`file exceeds ${MAX_LINES} lines`);
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '');
    if (Buffer.byteLength(line) > MAX_LINE_BYTES)
      throw new Error(`line ${index + 1} exceeds 64 KB`);
    if (!line.trim()) continue;
    try {
      const row = parseSignalRow(line, now);
      if (!ctx.dryRun) rows.push(row);
      ctx.stats.valid = ++counts.valid;
    } catch (error) {
      ctx.stats.invalid = ++counts.invalid;
      ctx.log(`line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  if (counts.invalid && !counts.valid) throw new Error('no valid line in the file');
  ctx.signal.throwIfAborted();
  if (!rows.length) return;

  const inserted = await ctx.db.transaction(async (tx) => {
    let count = 0;
    for (let start = 0; start < rows.length; start += 100) {
      ctx.signal.throwIfAborted();
      const added = await tx
        .insert(rawSignals)
        .values(rows.slice(start, start + 100))
        .onConflictDoNothing()
        .returning({ id: rawSignals.id });
      count += added.length;
    }
    ctx.signal.throwIfAborted();
    return count;
  });
  ctx.stats.inserted = inserted;
  ctx.stats.duplicates = rows.length - inserted;
}
