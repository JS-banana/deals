import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import proxy from './proxy';

const { handleI18n } = vi.hoisted(() => ({ handleI18n: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => handleI18n }));

describe('proxy locale routing', () => {
  beforeEach(() => {
    handleI18n.mockImplementation(() => NextResponse.next());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('permanently redirects legacy /en paths to the root English path with query preserved', () => {
    vi.stubEnv('SITE_URL', '');
    const cases: Array<[string, string]> = [
      ['http://localhost:3000/en', 'http://localhost:3000/'],
      ['http://localhost:3000/en/', 'http://localhost:3000/'],
      [
        'http://localhost:3000/en/p/tablepro?offer=35&sort=price',
        'http://localhost:3000/p/tablepro?offer=35&sort=price',
      ],
      ['http://localhost:3000/en//evil.com/x', 'http://localhost:3000/evil.com/x'],
      ['http://localhost:3000/en/\\evil.com/x', 'http://localhost:3000/evil.com/x'],
    ];

    for (const [url, expectedLocation] of cases) {
      const response = proxy(new NextRequest(url));
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(expectedLocation);
    }
    expect(handleI18n).not.toHaveBeenCalled();
  });

  it('uses configured SITE_URL origin and ignores spoofed forwarded host headers', () => {
    vi.stubEnv('SITE_URL', 'https://deals.laifuyou.com');
    const response = proxy(
      new NextRequest('http://127.0.0.1:3100/en/p/tablepro?offer=35', {
        headers: { 'x-forwarded-host': 'evil.com', host: 'evil.com' },
      }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://deals.laifuyou.com/p/tablepro?offer=35');
  });

  it('delegates non-/en routes such as /english and /zh paths to next-intl middleware', () => {
    for (const url of ['http://localhost:3000/english', 'http://localhost:3000/zh/p/tablepro']) {
      const response = proxy(new NextRequest(url));
      expect(response.status).toBe(200);
    }
    expect(handleI18n).toHaveBeenCalledTimes(2);
  });
});
