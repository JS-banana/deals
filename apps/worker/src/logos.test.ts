import { describe, expect, it } from 'vitest';
import type { Icon } from './fetcher.ts';
import { rankIcons, sniffImage } from './logos.ts';

const icon = (href: string, rel: Icon['rel'], size = 0, type: string | null = null): Icon => ({
  href,
  rel,
  size,
  type,
});

describe('rankIcons', () => {
  it('prefers apple-touch-icon, then sizable PNG, then SVG, then small PNG, then ICO, then /favicon.ico', () => {
    const urls = rankIcons(
      [
        icon('https://x.test/f.ico', 'icon', 0, 'image/x-icon'),
        icon('https://x.test/16.png', 'icon', 16, 'image/png'),
        icon('https://x.test/l.svg', 'icon', 0, 'image/svg+xml'),
        icon('https://x.test/192.png', 'icon', 192, 'image/png'),
        icon('https://x.test/512.png', 'icon', 512, 'image/png'),
        icon('https://x.test/a.png', 'apple-touch-icon', 180),
      ],
      'https://x.test/pricing',
    );
    expect(urls).toEqual([
      'https://x.test/a.png',
      'https://x.test/512.png',
      'https://x.test/192.png',
      'https://x.test/l.svg',
      'https://x.test/16.png',
      'https://x.test/f.ico',
      'https://x.test/favicon.ico',
    ]);
  });

  it('always falls back to /favicon.ico on the page origin, without duplicates', () => {
    expect(rankIcons([], 'https://x.test/a/b')).toEqual(['https://x.test/favicon.ico']);
    expect(rankIcons([icon('https://x.test/favicon.ico', 'icon')], 'https://x.test/')).toEqual([
      'https://x.test/favicon.ico',
    ]);
  });
});

describe('sniffImage', () => {
  it('recognises formats by content, not by the claimed type', () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('jpg');
    expect(sniffImage(Uint8Array.from([0, 0, 1, 0, 1, 0]))).toBe('ico');
    expect(sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"></svg>'))).toBe(
      'svg',
    );
    expect(sniffImage(new TextEncoder().encode('<!doctype html><html>404</html>'))).toBeNull();
  });
});
