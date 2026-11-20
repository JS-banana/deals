'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/** False during server rendering and hydration, true afterwards. */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
