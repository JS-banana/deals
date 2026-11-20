import { describe, expect, it } from 'vitest';
import { cleanMerchantUrl, entryKey, findKnown, parseReadme, permalink } from './upstream.ts';

const README = [
  '# Awesome Deals 2026', // 1
  '', // 2
  '## Sponsored Deals', // 3
  '', // 4
  '| Name | Description | Discount |', // 5
  '| --- | --- | --- |', // 6
  '| [Sponsor](https://sponsor.example) | Paid slot | 90% OFF |', // 7
  '', // 8
  '## Table of Contents', // 9
  '- [Developer Tools](#developer-tools)', // 10
  '', // 11
  '## 👨‍💻 Developer Tools', // 12
  '', // 13
  '### 💻 Developer macOS Apps', // 14
  '', // 15
  '|  | Name | Description | Discount Code & Terms |', // 16
  '| -- | --- | ------ | ------ |', // 17
  '| 🗃️ | [TablePro](https://tablepro.app/black-friday?ref=Awesome-Black-Friday-Cyber-Monday) | Native database client. | 40% OFF with code **BLACKFRIDAY2026** (Nov 19 - Dec 1) |', // 18
  '| 📧 | [MailScope](http://mailscope.app/blackfriday/) | Email debugging \\| for Mac.<br/>Local only. | **$19 USD** one-time (regular $29). Code **bf2026**. |', // 19
  '', // 20
  '### 💻 Tools & Services', // 21
  '', // 22
  '|  | Name | Description | Discount Code & Terms |', // 23
  '| -- | --- | ------ | ------ |', // 24
  '| 🛠️ | [TablePro](https://tablepro.app/other) | Duplicate in another table. | 10% OFF |', // 25
  '| 🪓 | [Karve](https://karve.dev/pricing/) | Windows HTTP client. | **75% OFF**, no code needed |', // 26
  '', // 27
  '## Utility Tools', // 28
  '- [Aurio](https://aurio.dev/) - Noise cancelling microphone. 25% OFF', // 29
].join('\n');

describe('parseReadme', () => {
  const entries = parseReadme(README);

  it('reads table rows under category headings with 1-based line numbers', () => {
    expect(entries.map((e) => [e.name, e.line])).toEqual([
      ['TablePro', 18],
      ['MailScope', 19],
      ['Karve', 26],
      ['Aurio', 29],
    ]);
    expect(entries[0]).toMatchObject({
      url: 'https://tablepro.app/black-friday?ref=Awesome-Black-Friday-Cyber-Monday',
      description: 'Native database client.',
      offer: '40% OFF with code **BLACKFRIDAY2026** (Nov 19 - Dec 1)',
      section: 'Developer Tools / Developer macOS Apps',
    });
  });

  it('skips sponsors and the table of contents, and de-duplicates by name and host', () => {
    expect(entries.some((e) => e.name === 'Sponsor')).toBe(false);
    expect(entries.filter((e) => e.name === 'TablePro')).toHaveLength(1);
  });

  it('handles escaped pipes and <br/> inside cells', () => {
    expect(entries[1]?.description).toBe('Email debugging | for Mac. Local only.');
  });

  it('keeps the section path of list items and resets it at a new heading', () => {
    expect(entries[3]).toMatchObject({
      name: 'Aurio',
      description: 'Noise cancelling microphone. 25% OFF',
      section: 'Utility Tools',
    });
  });
});

describe('upstream helpers', () => {
  it('builds a permalink to the README line at the processed commit', () => {
    expect(permalink('abc123', 70)).toBe(
      'https://github.com/trungdq88/Awesome-Black-Friday-Cyber-Monday/blob/abc123/README.md#L70',
    );
  });

  it('strips tracking parameters and upgrades to https', () => {
    expect(cleanMerchantUrl('http://x.app/pricing?utm_source=a&ref=b&plan=pro')).toBe(
      'https://x.app/pricing?plan=pro',
    );
    expect(cleanMerchantUrl('https://x.app/?ref=awesome')).toBe('https://x.app/');
  });

  it('keys entries by normalized name and host, independent of line and tracking', () => {
    expect(entryKey('Table Pro', 'https://www.tablepro.app/x')).toBe(
      entryKey('tablepro', 'https://tablepro.app/y'),
    );
  });

  it('matches known products by name or merchant host but not by shared marketplaces', () => {
    const product = (slug: string, name: string, hosts: string[]) => ({
      id: 1,
      slug,
      name,
      category: 'developer' as const,
      website: null,
      summary: { zh: '', en: '' },
      logoPath: null,
      hosts: new Set(hosts),
      inTargetEvent: true,
    });
    const catalog = {
      products: [
        product('tablepro', 'TablePro', ['tablepro.app']),
        product('other', 'Other', ['apps.apple.com']),
      ],
      events: [],
      targetEvent: 'bfcm-2026',
    };
    expect(findKnown(catalog, { name: 'TablePro', url: 'https://elsewhere.com' })?.slug).toBe(
      'tablepro',
    );
    expect(findKnown(catalog, { name: 'Renamed', url: 'https://tablepro.app/new' })?.slug).toBe(
      'tablepro',
    );
    expect(
      findKnown(catalog, { name: 'New App', url: 'https://apps.apple.com/us/app/new/id1' }),
    ).toBeUndefined();
  });
});
