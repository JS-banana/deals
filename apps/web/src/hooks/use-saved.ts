'use client';

import { useSyncExternalStore } from 'react';

/** New entries identify offers. Existing product bookmarks still open that product's main deal. */
export const SAVED_KEY = 'deal-index:saved';

const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
let lastRaw: string | null | undefined;
let lastValue: readonly string[] = EMPTY;

function parse(raw: string | null): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): readonly string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVED_KEY);
  } catch {
    // Storage can be blocked (private mode); behave as if nothing is saved.
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = parse(raw);
  }
  return lastValue;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function write(slugs: readonly string[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(slugs));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

export const toggleSaved = (key: string, slug: string) => {
  const current = getSnapshot();
  write(
    current.includes(key) || current.includes(slug)
      ? current.filter((s) => s !== key && s !== slug)
      : [...current, key],
  );
};

export const clearSaved = () => write([]);

export function useSaved() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
