'use client';

import { useSyncExternalStore } from 'react';
import type { CompareRow } from '@/lib/deal-view';

/** Up to three deals picked for side-by-side comparison. Kept in memory for the browsing session. */
export const COMPARE_MAX = 3;

const EMPTY: readonly CompareRow[] = [];
const listeners = new Set<() => void>();
let rows: readonly CompareRow[] = EMPTY;

function set(next: readonly CompareRow[]) {
  rows = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Adds the row, or removes it when already picked. Returns false when the list is full. */
export function toggleCompare(row: CompareRow): boolean {
  if (rows.some((r) => r.id === row.id)) {
    set(rows.filter((r) => r.id !== row.id));
    return true;
  }
  if (rows.length >= COMPARE_MAX) return false;
  set([...rows, row]);
  return true;
}

export const removeCompare = (id: number) => set(rows.filter((r) => r.id !== id));
export const clearCompare = () => set(EMPTY);

export function useCompare() {
  return useSyncExternalStore(
    subscribe,
    () => rows,
    () => EMPTY,
  );
}
