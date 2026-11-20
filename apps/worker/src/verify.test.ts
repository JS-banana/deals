import type { Deal } from '@deals/core';
import { describe, expect, it } from 'vitest';
import {
  checkDates,
  codeAppears,
  mergeVolatile,
  numberAppears,
  pickEvent,
  stripUnverified,
  verifyEvidence,
} from './verify.ts';

const page = {
  url: 'https://m.test/bf',
  text: 'Black  Friday\nCode  BF2026 is prefilled.\n$19 one-time (regular $29)\nSolo $1,194 first year',
};
const upstream = {
  url: 'https://gh/L1',
  text: '**$19 USD** one-time, ~~$29~~ code **bf2026**. Nov 18–30, 2026',
};

describe('verifyEvidence', () => {
  it('keeps verbatim quotes, tolerating whitespace and markdown, and records where they came from', () => {
    const { kept, dropped } = verifyEvidence(
      [
        { field: 'code', quote: 'Code BF2026 is prefilled.' },
        { field: 'priceAmount', quote: '$19 USD one-time' },
        { field: 'endsOn', quote: 'Nov 18-30, 2026' },
      ],
      [page, upstream],
    );
    expect(dropped).toBe(0);
    expect(kept.map((e) => e.url)).toEqual([page.url, upstream.url, upstream.url]);
  });

  it('drops paraphrases, invented quotes and trivially short ones', () => {
    const { kept, dropped } = verifyEvidence(
      [
        { field: 'priceAmount', quote: 'Only $19, a steal' },
        { field: 'code', quote: 'BF' },
        { field: 'x', quote: 'code bf2026 is prefilled' },
      ],
      [page, upstream],
    );
    expect(kept).toEqual([]);
    expect(dropped).toBe(3);
  });
});

describe('numberAppears / codeAppears', () => {
  it('matches amounts however they are written, but not inside longer numbers', () => {
    expect(numberAppears(19, page.text)).toBe(true);
    expect(numberAppears(1194, page.text)).toBe(true);
    expect(numberAppears(47.4, 'now $47.40 only')).toBe(true);
    expect(numberAppears(17.7, 'nur 17,70 €')).toBe(true);
    expect(numberAppears(47, 'now $47.40 only')).toBe(false);
    expect(numberAppears(9, page.text)).toBe(false);
    expect(numberAppears(194, page.text)).toBe(false);
  });

  it('matches coupon codes case-insensitively as whole tokens', () => {
    expect(codeAppears('bf2026', page.text)).toBe(true);
    expect(codeAppears('BF26', 'use BF2026 now')).toBe(false);
    expect(codeAppears('SAVE20', 'Use code SAVE20.')).toBe(true);
  });
});

const deal = (over: Partial<Deal> = {}): Deal => ({
  plan: { zh: 'Pro 买断', en: 'Pro lifetime' },
  priceAmount: 19,
  originalAmount: 29,
  currency: 'USD',
  billing: 'one_time',
  discountPercent: null,
  discountAmount: null,
  code: 'BF2026',
  noCode: false,
  startsOn: null,
  endsOn: '2026-11-30',
  startsAt: null,
  endsAt: null,
  dateZone: null,
  observedLiveOn: null,
  oneTime: true,
  existingUsers: false,
  terms: { zh: '条款', en: 'Terms' },
  renewal: null,
  eligibility: null,
  cardNote: null,
  merchantUrl: 'https://m.test/bf',
  sourceUrl: null,
  verified: false,
  checkedOn: '2026-11-20',
  ...over,
});

describe('stripUnverified', () => {
  it('clears amounts, percentages and codes the sources do not state', () => {
    const { deal: out, notes } = stripUnverified(
      deal({ priceAmount: 15, discountPercent: 40, code: 'NOPE' }),
      page.text,
    );
    expect(out).toMatchObject({
      priceAmount: null,
      originalAmount: 29,
      discountPercent: null,
      code: null,
    });
    expect(notes).toHaveLength(3);
  });
  it('leaves a fully supported deal untouched', () => {
    expect(stripUnverified(deal(), page.text)).toEqual({ deal: deal(), notes: [] });
  });
});

describe('pickEvent', () => {
  const events = [
    {
      slug: 'evergreen',
      kind: 'evergreen' as const,
      featured: false,
      startsOn: null,
      endsOn: null,
    },
    {
      slug: 'bfcm-2026',
      kind: 'seasonal' as const,
      featured: true,
      startsOn: '2026-11-01',
      endsOn: '2026-12-07',
    },
    {
      slug: 'old',
      kind: 'seasonal' as const,
      featured: true,
      startsOn: '2026-06-01',
      endsOn: '2026-06-20',
    },
  ];
  it('picks the featured, unfinished seasonal event the deal overlaps', () => {
    expect(pickEvent(events, { startsOn: '2026-11-18', endsOn: '2026-11-30' }, '2026-11-20')).toBe(
      'bfcm-2026',
    );
    expect(pickEvent(events, { startsOn: null, endsOn: null }, '2026-11-20')).toBe('bfcm-2026');
    expect(pickEvent(events, { startsOn: '2026-11-20', endsOn: '2026-12-31' }, '2026-11-20')).toBe(
      'bfcm-2026',
    );
  });
  it('falls back to evergreen when no event overlaps or the event has ended', () => {
    expect(pickEvent(events, { startsOn: '2027-01-10', endsOn: '2027-01-20' }, '2026-11-20')).toBe(
      'evergreen',
    );
    expect(pickEvent(events, { startsOn: '2026-06-05', endsOn: '2026-06-10' }, '2026-11-20')).toBe(
      'evergreen',
    );
  });
});

describe('checkDates', () => {
  const now = new Date('2026-11-20T04:00:00Z');
  it('flags ended offers and clears implausible far-future dates', () => {
    expect(checkDates(deal({ endsOn: '2026-11-10' }), now, '2026-11-20').ended).toBe(true);
    expect(checkDates(deal(), now, '2026-11-20').ended).toBe(false);
    const far = checkDates(deal({ endsOn: '2030-01-01' }), now, '2026-11-20');
    expect(far.deal.endsOn).toBeNull();
    expect(far.notes).toHaveLength(1);
  });
});

describe('mergeVolatile (field diff)', () => {
  it('reports only real changes with before and after', () => {
    const { deal: merged, changes } = mergeVolatile(deal(), {
      priceAmount: 24,
      originalAmount: 29,
      endsOn: '2026-12-02',
    });
    expect(changes).toEqual([
      { field: 'priceAmount', before: 19, after: 24 },
      { field: 'endsOn', before: '2026-11-30', after: '2026-12-02' },
    ]);
    expect(merged).toMatchObject({ priceAmount: 24, endsOn: '2026-12-02' });
  });

  it('never erases a published value with null or undefined', () => {
    expect(mergeVolatile(deal(), { priceAmount: null, code: null }).changes).toEqual([]);
  });

  it('compares instants by time, and localized text by its Chinese source only', () => {
    const before = deal({ endsAt: '2026-12-01T08:00:00.000Z', terms: { zh: '条款', en: '' } });
    const result = mergeVolatile(before, {
      endsAt: '2026-12-01T00:00:00-08:00',
      terms: { zh: '条款', en: 'Terms (reworded)' },
    });
    expect(result.changes).toEqual([]);
  });

  it('keeps the published English when the recheck returns the same zh without English', () => {
    const before = deal({ terms: { zh: '年付 $39。', en: 'Billed annually at $39.' } });
    const result = mergeVolatile(before, { terms: { zh: '年付 $39。', en: '' } });
    expect(result.changes).toEqual([]);
    expect(result.deal.terms.en).toBe('Billed annually at $39.');
  });

  it('ignores rewording that keeps every number, but notices changed facts', () => {
    const before = deal({ terms: { zh: '年付 $39，含 3 台设备。', en: '' } });
    expect(
      mergeVolatile(before, { terms: { zh: '年付 $39，可在 3 台设备使用。', en: 'x' } }).changes,
    ).toEqual([]);
    expect(
      mergeVolatile(before, { terms: { zh: '年付 $49，含 3 台设备。', en: 'x' } }).changes,
    ).toHaveLength(1);
    expect(
      mergeVolatile(deal({ renewal: null }), { renewal: { zh: '次年 $39。', en: 'x' } }).changes,
    ).toHaveLength(1);
  });

  it('does not treat a missing "no code needed" statement as a change, and keeps code and noCode consistent', () => {
    expect(mergeVolatile(deal({ code: null, noCode: true }), { noCode: false }).changes).toEqual(
      [],
    );
    const { deal: merged, changes } = mergeVolatile(deal({ code: null, noCode: true }), {
      code: 'NEW1',
    });
    expect(merged).toMatchObject({ code: 'NEW1', noCode: false });
    expect(changes.map((c) => c.field).sort()).toEqual(['code', 'noCode']);
    expect(mergeVolatile(deal(), { noCode: true }).changes).toEqual([]);
  });
});
