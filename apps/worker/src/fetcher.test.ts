import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import tls from 'node:tls';
import { Client, fetch, Response } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, createFetcher, extractPage, normalizeText } from './fetcher.ts';

const resolveHost = vi.hoisted(() => vi.fn<(host: string) => LookupAddress[]>());
vi.mock('node:dns', () => ({
  lookup: (
    host: string,
    options: { all: boolean },
    done: (err: null, ips: LookupAddress[]) => void,
  ) => {
    expect(options.all).toBe(true);
    done(null, resolveHost(host));
  },
}));
vi.mock('undici', async (original) => {
  const undici = await original<typeof import('undici')>();
  return { ...undici, Client: vi.fn(undici.Client), fetch: vi.fn() };
});

const HTML = `<!doctype html><html><head>
<title> Acme  Pricing </title>
<meta name="description" content="Fast tool for teams">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
<link rel="icon" href="https://cdn.example.net/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/a.css">
<style>.x{color:red}</style><script>window.secret = 'nope'</script></head>
<body><nav>Docs</nav>
<h1>Black Friday</h1>
<p>Save <span>$</span><span>47.40</span> today</p>
<ul><li>Pro plan</li><li>Team plan</li></ul>
<table><tr><td>Solo</td><td>$174</td></tr></table>
Line one<br>Line two
<noscript>enable js</noscript><svg><text>icon text</text></svg><template><p>tmpl</p></template>
<script>track()</script></body></html>`;

describe('extractPage', () => {
  const page = extractPage(HTML, 'https://acme.test/pricing');

  it('keeps headings, prices, list items and table rows on separate lines', () => {
    expect(page.title).toBe('Acme Pricing');
    expect(page.text).toContain('Acme Pricing\nFast tool for teams\n');
    expect(page.text).toContain(
      'Black Friday\nSave $47.40 today\nPro plan\nTeam plan\nSolo | $174 |',
    );
    expect(page.text).toContain('Line one\nLine two');
  });

  it('drops script, style, noscript, svg and template content', () => {
    for (const noise of ['secret', 'color:red', 'enable js', 'icon text', 'tmpl', 'track()']) {
      expect(page.text).not.toContain(noise);
    }
  });

  it('keeps the visible sale status and ignores hidden alternatives', () => {
    const sale = extractPage(
      `<div data-sale>
        <p data-for="live">On sale until November 30.</p>
        <p data-for="ended" hidden>This sale has <strong>ended</strong>.</p>
      </div>`,
      'https://acme.test/black-friday',
    );
    expect(sale.text).toBe('On sale until November 30.');
  });

  it('collects icon candidates with absolute URLs and sizes', () => {
    expect(page.icons).toEqual([
      { href: 'https://acme.test/favicon-32.png', rel: 'icon', size: 32, type: 'image/png' },
      { href: 'https://acme.test/apple.png', rel: 'apple-touch-icon', size: 180, type: null },
      { href: 'https://cdn.example.net/logo.svg', rel: 'icon', size: 0, type: 'image/svg+xml' },
    ]);
  });

  it('reports the body length so JS-rendered shells can be detected', () => {
    const shell = extractPage(
      '<html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>',
      'https://x.test',
    );
    expect(shell.bodyChars).toBe(0);
    expect(page.bodyChars).toBeGreaterThan(50);
  });
});

describe('normalizeText', () => {
  it('collapses whitespace, drops blank and repeated lines', () => {
    expect(normalizeText('  a   b \n\n\n a b\n\tc  \r\nc')).toBe('a b\nc');
  });
});

describe('assertPublicUrl', () => {
  it('rejects loopback, private and non-http targets', () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'file:///etc/passwd',
      'http://db.internal/',
      'http://localhost./',
      'https://100.64.0.1/',
      'https://169.254.0.1/',
      'https://172.31.255.255/',
      'https://192.0.2.10/',
      'https://198.19.255.255/',
      'https://224.0.0.1/',
      'https://255.255.255.255/',
      'https://[::]/',
      'https://[::ffff:c000:201]/',
      'https://[64:ff9b::1]/',
      'https://[febf::1]/',
      'https://[fd00::1]/',
      'https://[ff02::1]/',
      'https://[2001:db8::1]/',
      'https://[2002::1]/',
      'https://[3fff::1]/',
    ]) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
    expect(assertPublicUrl('https://example.com/a').hostname).toBe('example.com');
    expect(assertPublicUrl('https://[2606:4700::1111]/').hostname).toBe('[2606:4700::1111]');
    expect(assertPublicUrl('https://fc-news.example/').hostname).toBe('fc-news.example');
  });
});

describe('fetcher transport', () => {
  const publicIPs = [
    { address: '93.184.215.14', family: 4 },
    { address: '2606:4700::1111', family: 6 },
  ];
  const options = { accept: 'text/plain', maxBytes: 4 };
  const start = 'https://merchant.invalid/start';
  const open = vi.fn<(url: URL, ips: LookupAddress[]) => Response>();

  beforeEach(() => {
    vi.clearAllMocks();
    resolveHost.mockReset().mockReturnValue(publicIPs);
    open.mockReset();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const [origin, config] = vi.mocked(Client).mock.lastCall ?? [];
      expect(origin).toBe(url.origin);
      expect(init?.dispatcher).toBeInstanceOf(Client);
      expect(init?.redirect).toBe('manual');
      // Exercise the lookup installed on the actual dispatcher, as Node's socket would.
      const connect = config?.connect as { lookup: LookupFunction };
      const ips = await new Promise<LookupAddress[]>((resolve, reject) => {
        connect.lookup(url.hostname, { all: true }, (error, addresses) => {
          if (error) reject(error);
          else if (Array.isArray(addresses)) resolve(addresses);
          else reject(new Error('expected all socket addresses'));
        });
      });
      return open(url, ips);
    });
  });

  it('passes the merchant hostname, SNI and checked lookup to the TLS socket', async () => {
    const undici = await vi.importActual<typeof import('undici')>('undici');
    vi.mocked(fetch).mockImplementationOnce(undici.fetch);
    // Stop at the TLS boundary: use the real dispatcher without opening a network connection.
    const dial = vi.spyOn(tls, 'connect').mockImplementation(() => {
      throw new Error('offline');
    });
    try {
      await expect(
        createFetcher(new AbortController().signal, 1, 0).raw(start, options),
      ).rejects.toMatchObject({ cause: { message: 'offline' } });
      const [socketOptions] = dial.mock.calls[0] ?? [];
      expect(socketOptions).toMatchObject({
        host: 'merchant.invalid',
        servername: 'merchant.invalid',
      });
      const socket = socketOptions as tls.ConnectionOptions;
      expect(socket.rejectUnauthorized).not.toBe(false);
      const checked = vi.fn();
      socket.lookup?.('merchant.invalid', { all: true }, checked);
      expect(checked).toHaveBeenCalledWith(null, publicIPs);
      expect(resolveHost).toHaveBeenCalledOnce();
    } finally {
      dial.mockRestore();
    }
  });

  it('uses checked socket answers for each origin, keeps the host and cancels redirect bodies', async () => {
    const cancel = vi.fn();
    open
      .mockReturnValueOnce(
        new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: 'https://cdn.invalid/deal' },
        }),
      )
      .mockReturnValueOnce(new Response('done'));
    const result = await createFetcher(new AbortController().signal, 1, 0).raw(start, options);
    expect(resolveHost.mock.calls).toEqual([['merchant.invalid'], ['cdn.invalid']]);
    expect(open.mock.calls.map(([url, ips]) => [url.href, ips])).toEqual([
      [start, publicIPs],
      ['https://cdn.invalid/deal', publicIPs],
    ]);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBe(
      vi.mocked(fetch).mock.calls[1]?.[1]?.signal,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.url).toBe('https://cdn.invalid/deal');
    expect(new TextDecoder().decode(result.body)).toBe('done');
    expect(result.truncated).toBe(false);
  });

  it('drops feed credentials when a redirect changes origin', async () => {
    open
      .mockReturnValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.invalid/feed' } }),
      )
      .mockReturnValueOnce(new Response('ok'));
    await createFetcher(new AbortController().signal, 1, 0).raw(start, {
      ...options,
      headers: { authorization: 'Bearer fixture' },
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toHaveProperty('authorization');
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).not.toHaveProperty('authorization');
  });

  it.each([false, true])(
    'rejects an entire mixed DNS answer before connecting (redirect=%s)',
    async (redirect) => {
      if (redirect) {
        resolveHost.mockReturnValueOnce(publicIPs);
        open.mockReturnValueOnce(
          new Response(null, { status: 307, headers: { location: '/next' } }),
        );
      }
      resolveHost.mockReturnValue([...publicIPs, { address: 'fd00::1', family: 6 }]);
      await expect(
        createFetcher(new AbortController().signal, 1, 0).raw(start, options),
      ).rejects.toThrow('non-public-host');
      expect(open).toHaveBeenCalledTimes(redirect ? 1 : 0);
      expect(resolveHost).toHaveBeenCalledTimes(redirect ? 2 : 1);
    },
  );

  it.each(['https://[::1]/', 'file:///example'])(
    'validates redirect destination %s before dispatch',
    async (location) => {
      open.mockReturnValue(new Response(null, { status: 303, headers: { location } }));
      await expect(
        createFetcher(new AbortController().signal, 1, 0).raw(start, options),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([5, 6])('enforces the five-redirect boundary for %i redirects', async (count) => {
    let remaining = count;
    open.mockImplementation(() =>
      remaining-- > 0
        ? new Response(null, { status: 308, headers: { location: './next' } })
        : new Response('done'),
    );
    const result = createFetcher(new AbortController().signal, 1, 0).raw(start, options);
    if (count === 5)
      await expect(result).resolves.toMatchObject({ url: 'https://merchant.invalid/next' });
    else await expect(result).rejects.toThrow('too-many-redirects');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('returns only the allowed bytes and cancels the remaining body', async () => {
    const cancel = vi.fn();
    open.mockReturnValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('large'));
          },
          cancel,
        }),
      ),
    );
    const result = await createFetcher(new AbortController().signal, 1, 0).raw(start, options);
    expect(new TextDecoder().decode(result.body)).toBe('larg');
    expect(result.truncated).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('honors cancellation while waiting for a redirected host slot', async () => {
    const controller = new AbortController();
    open.mockImplementationOnce(() => {
      queueMicrotask(() => controller.abort());
      return new Response(null, { status: 301, headers: { location: '/next' } });
    });
    await expect(
      createFetcher(controller.signal, 1, 1000).raw(start, options),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
