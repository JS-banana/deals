import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWebhook, webhookBody } from './notify.ts';

afterEach(() => vi.unstubAllGlobals());
describe('notification formats', () => {
  it('formats all supported channels and disables Discord mass mentions', () => {
    expect(webhookBody('feishu', 'text')).toEqual({ msg_type: 'text', content: { text: 'text' } });
    for (const kind of ['wecom', 'dingtalk'] as const)
      expect(webhookBody(kind, 'text')).toEqual({ msgtype: 'text', text: { content: 'text' } });
    expect(webhookBody('slack', 'text')).toEqual({ text: 'text' });
    expect(webhookBody('discord', '@everyone')).toEqual({
      content: '@everyone',
      allowed_mentions: { parse: [] },
    });
  });
  it('recognizes provider failures at HTTP 200 and honours transport failures', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ errcode: 93000 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ code: 0 }));
    vi.stubGlobal('fetch', send);
    const signal = new AbortController().signal;
    await expect(postWebhook('https://fixture.invalid', 'wecom', 'test', signal)).rejects.toThrow(
      'rejected',
    );
    await expect(postWebhook('https://fixture.invalid', 'discord', 'test', signal)).rejects.toThrow(
      '429',
    );
    await expect(
      postWebhook('https://fixture.invalid', 'feishu', 'test', signal),
    ).resolves.toBeUndefined();
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });
});
