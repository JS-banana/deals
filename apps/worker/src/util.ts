import { createHash } from 'node:crypto';

export type Stats = Record<string, number>;

export const bump = (stats: Stats, key: string, by = 1) => {
  stats[key] = (stats[key] ?? 0) + by;
};

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Runs at most `limit` tasks at once; extra callers wait in FIFO order. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * Process `items` with `concurrency` workers. A failing item is reported through `onError`
 * and never stops the others. Stops picking up new items once `signal` aborts.
 */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  fn: (item: T, index: number) => Promise<void>,
  onError: (item: T, error: unknown) => void,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      try {
        await fn(item, index);
      } catch (error) {
        onError(item, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
