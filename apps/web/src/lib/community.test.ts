import { afterEach, describe, expect, it, vi } from 'vitest';
import { communityIdentity, readCommunityInput, tipInput, voteInput } from './community';

describe('community submissions', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('derives an anonymous identity only with the trusted IP header and secret', () => {
    const h = new Headers({ 'user-agent': 'browser', 'x-forwarded-for': '192.0.2.1' });
    vi.stubEnv('COMMUNITY_HASH_SECRET', 'fixture');
    expect(communityIdentity(h)).toBeNull();
    h.set('x-real-ip', '192.0.2.1');
    const identity = communityIdentity(h);
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(communityIdentity(h)).toBe(identity);
    h.set('user-agent', 'another browser');
    expect(communityIdentity(h)).not.toBe(identity);
    vi.stubEnv('COMMUNITY_HASH_SECRET', '');
    expect(communityIdentity(h)).toBeNull();
  });

  it('validates links, descriptions and vote values before storing them', () => {
    for (const url of ['broken', 'file:///example', 'https://user:pass@example.org/']) {
      expect(tipInput.safeParse({ url, note: 'Offer' }).success).toBe(false);
    }
    expect(tipInput.safeParse({ url: 'https://example.org/offer', note: '   ' }).success).toBe(
      false,
    );
    expect(tipInput.safeParse({ url: 'https://example.org/offer', note: 'Offer' }).success).toBe(
      true,
    );
    expect(voteInput.safeParse({ dealId: 1, valid: 'false' }).success).toBe(false);
    expect(voteInput.safeParse({ dealId: 2147483648, valid: false }).success).toBe(false);
  });

  it('bounds the body before JSON parsing', async () => {
    const request = (body: string, type = 'application/json') =>
      new Request('https://example.org', {
        method: 'POST',
        body,
        headers: { 'content-type': type },
      });
    expect(await readCommunityInput(request('{"ok":true}'))).toEqual({ ok: true });
    expect(await readCommunityInput(request('{"ok":true}', 'text/plain'))).toBeNull();
    expect(await readCommunityInput(request('invalid'))).toBeNull();
    expect(await readCommunityInput(request(JSON.stringify('a'.repeat(8193))))).toBeNull();
  });
});
