import { describe, expect, it } from 'vitest';
import en from './en.json';
import zh from './zh.json';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('UI messages', () => {
  it('define the same keys in every locale', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort());
  });
});
