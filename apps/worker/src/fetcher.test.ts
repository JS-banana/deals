import { describe, expect, it } from 'vitest';
import { assertPublicUrl, extractPage, normalizeText } from './fetcher.ts';

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
    ]) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
    expect(assertPublicUrl('https://example.com/a').hostname).toBe('example.com');
  });
});
