import { describe, expect, it } from 'vitest';
import { factProblem, needsRevision, publishable } from './pipeline.ts';

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
