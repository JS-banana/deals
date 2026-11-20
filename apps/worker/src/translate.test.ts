import { describe, expect, it } from 'vitest';
import { keepsFacts } from './translate.ts';

describe('keepsFacts', () => {
  const item = {
    zh: '年付首年 $23.40，此后每年 $39。代码 BFCM2026，含 3 年更新。',
    product: 'TablePro',
  };
  it('accepts a translation that keeps numbers and codes', () => {
    expect(
      keepsFacts(
        item,
        'First year $23.40, then $39 a year. Code BFCM2026, includes 3 years of updates.',
      ),
    ).toBe(true);
  });
  it('lets a Chinese month number become a month name', () => {
    expect(keepsFacts({ zh: '12 月 7 日结束', product: 'X' }, 'Ends December 7')).toBe(true);
  });
  it('rejects altered numbers, lost codes and leaked Chinese', () => {
    expect(keepsFacts(item, 'First year $23, then $39. Code BFCM2026, 3 years.')).toBe(false);
    expect(keepsFacts(item, 'First year $23.40, then $39. Code BF2026, 3 years.')).toBe(false);
    expect(keepsFacts(item, '首年 $23.40, then $39. Code BFCM2026, 3 years.')).toBe(false);
  });
});
