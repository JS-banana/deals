import type { RawSignal } from '@deals/db';
import { assertPublicUrl } from '../fetcher.ts';
import type { Ctx } from '../runtime.ts';

export type { RawSignal };
export interface SourceConfig {
  id: string;
  type: RawSignal['sourceType'];
  target: string;
  enabled: boolean;
  quota: number;
}
export interface Batch {
  cursor: string | null;
  signals: RawSignal[];
}
export type SourceAdapter = (
  ctx: Ctx,
  source: SourceConfig,
  cursor: string | null,
) => Promise<Batch>;
export const sourceSwitch = (id: string) =>
  `SOURCE_${id.toUpperCase().replaceAll('-', '_')}_ENABLED`;
export class SourceHttpError extends Error {
  readonly status: number;
  constructor(status: number, truncated: boolean) {
    super(`source HTTP ${status}${truncated ? ' (oversize)' : ''}`);
    this.status = status;
  }
}
export async function readSource(
  ctx: Ctx,
  url: string,
  accept: string,
  headers?: Record<string, string>,
) {
  const result = await ctx.fetcher.raw(url, { accept, maxBytes: 6 * 1024 * 1024, headers });
  if (result.status < 200 || result.status >= 300 || result.truncated)
    throw new SourceHttpError(result.status, result.truncated);
  return new TextDecoder().decode(result.body);
}
export function httpsLink(value: unknown, base?: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  try {
    const u = assertPublicUrl(new URL(value.trim(), base).href);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
