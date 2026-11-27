import { describe, expect, it, vi } from 'vitest';
import type { Llm } from './llm.ts';
import { factProblem, needsRevision, publishable, runPipeline } from './pipeline.ts';

describe('factProblem', () => {
  const item = {
    zh: '年付首年 $23.40，此后每年 $39。代码 BFCM2026，含 3 年更新。',
    product: 'TablePro',
  };
  it('accepts a translation that keeps numbers and codes', () => {
    expect(
      factProblem(
        item,
        'First year $23.40, then $39 a year. Code BFCM2026, includes 3 years of updates.',
      ),
    ).toBeNull();
  });
  it('lets a Chinese month number become a month name', () => {
    expect(factProblem({ zh: '12 月 7 日结束', product: 'X' }, 'Ends December 7')).toBeNull();
  });
  it.each([
    ['最高每月 320 万词', 'up to 3.2 million words'],
    ['最高每月 320 万词', '3,200,000 words'],
    ['最高每月 320 万词', '3.2M words'],
    ['每月 25 万词', '250,000 words'],
    ['每月 25 万词', '250K words'],
    ['1亿 tokens', '100 million tokens'],
    ['100 万积分/月', '1 million credits/month'],
    ['3.5万词', '35 thousand words'],
    ['1,200万词', '12000000 words'],
    ['15亿词', '1.5bn words'],
    ['每月 320 万词，赠 25 万积分', '250k bonus credits and 3.2mn words/month'],
    ['1 万亿 tokens', '1 trillion tokens'],
    ['10 万词额度', 'a 100-thousand-word quota'],
    ['2026 万圣节优惠', '2026 Halloween sale'],
  ])('accepts equivalent quantities in %s and %s', (zh, en) => {
    expect(factProblem({ zh, product: 'X' }, en)).toBeNull();
  });
  it.each([
    ['最高每月 320 万词', '320 words'],
    ['最高每月 320 万词', '32 million words'],
    ['最高每月 320 万词', '3.200004 million words'],
    ['每月 320 万词，赠 25 万积分', '3.2 million words/month'],
    ['320 万词，有效期 320 天', '3.2 million words'],
    ['15 亿积分', '1,499,999,000 credits'],
    ['1 万亿 tokens', '10,000 tokens'],
  ])('rejects missing or altered quantities in %s and %s', (zh, en) => {
    expect(factProblem({ zh, product: 'X' }, en)).not.toBeNull();
  });
  it('rejects altered numbers, lost codes and leaked Chinese', () => {
    expect(factProblem(item, 'First year $23, then $39. Code BFCM2026, 3 years.')).not.toBeNull();
    expect(factProblem(item, 'First year $23.40, then $39. Code BF2026, 3 years.')).not.toBeNull();
    expect(factProblem(item, '首年 $23.40, then $39. Code BFCM2026, 3 years.')).not.toBeNull();
  });
});

describe('publish rule', () => {
  const ok = { en: 'Pro lifetime license', problems: [], score: 90 };
  it('publishes a clean translation at or above 70', () => {
    expect(publishable(ok)).toBe(true);
    expect(publishable({ ...ok, score: 70 })).toBe(true);
  });
  it('refuses low scores, deterministic failures and empty output', () => {
    expect(publishable({ ...ok, score: 69 })).toBe(false);
    expect(publishable({ ...ok, problems: ['"$39" missing from the English'] })).toBe(false);
    expect(publishable({ ...ok, en: '' })).toBe(false);
  });
  it('sends anything below 85 or with a failure to revision', () => {
    expect(needsRevision({ problems: [], score: 85 })).toBe(false);
    expect(needsRevision({ problems: [], score: 84 })).toBe(true);
    expect(needsRevision({ problems: ['x'], score: 99 })).toBe(true);
  });
});

describe('runPipeline', () => {
  const sources = [
    { id: 't1', field: 'terms', product: 'TablePro', zh: '使用优惠码 BF2026 享 5 折。' },
    { id: 't2', field: 'plan', product: 'TablePro', zh: 'Pro 年付 · $29' },
  ];

  it('defaults to single-pass deterministic evaluation with one LLM call', async () => {
    const json = vi.fn(async (req) =>
      req.parse({
        translations: {
          t1: '50% off with code BF2026.',
          t2: 'Pro annual plan · $29',
        },
      }),
    );
    const llm: Llm = { json };
    const outcomes = await runPipeline(llm, {}, new AbortController().signal, sources);
    expect(json).toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => ({ id: o.id, score: o.score, revisions: o.revisions }))).toEqual([
      { id: 't1', score: 90, revisions: 0 },
      { id: 't2', score: 90, revisions: 0 },
    ]);
    expect(outcomes.every(publishable)).toBe(true);
  });

  it('runs one revision pass when a deterministic fact is dropped in default mode', async () => {
    let calls = 0;
    const json = vi.fn(async (req) => {
      calls++;
      if (calls === 1) {
        return req.parse({
          translations: { t1: '50% off.', t2: 'Pro annual plan · $29' },
        });
      }
      return req.parse({
        translations: { t1: '50% off with code BF2026.' },
      });
    });
    const outcomes = await runPipeline({ json }, {}, new AbortController().signal, sources);
    expect(json).toHaveBeenCalledTimes(2);
    expect(outcomes[0]).toMatchObject({
      id: 't1',
      en: '50% off with code BF2026.',
      score: 90,
      revisions: 1,
    });
    expect(outcomes.every(publishable)).toBe(true);
  });

  it('does not fan out or revise on HTTP 429 provider errors', async () => {
    const json = vi.fn(async () => {
      throw new Error('LLM HTTP 429');
    });
    const outcomes = await runPipeline({ json }, {}, new AbortController().signal, sources);
    expect(json).toHaveBeenCalledTimes(1);
    expect(outcomes.every((o) => o.score === 0 && !publishable(o) && o.revisions === 0)).toBe(true);
  });

  it('runs translate plus LLM review when review mode is enabled', async () => {
    let calls = 0;
    const json = vi.fn(async (req) => {
      calls++;
      if (calls === 1) {
        return req.parse({
          translations: {
            t1: '50% off with code BF2026.',
            t2: 'Pro annual plan · $29',
          },
        });
      }
      return req.parse({
        reviews: {
          t1: {
            fidelity: 95,
            terminology: 95,
            naturalness: 95,
            concision: 95,
            formatting: 95,
            score: 95,
            issues: [],
          },
          t2: {
            fidelity: 95,
            terminology: 95,
            naturalness: 95,
            concision: 95,
            formatting: 95,
            score: 95,
            issues: [],
          },
        },
      });
    });
    const outcomes = await runPipeline({ json }, {}, new AbortController().signal, sources, {
      review: true,
    });
    expect(json).toHaveBeenCalledTimes(2);
    expect(outcomes.map((o) => o.score)).toEqual([95, 95]);
  });
});
