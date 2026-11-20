import { describe, expect, it } from 'vitest';
import { decide, normalizeSource, sourceHash } from './translate.ts';

describe('source hash', () => {
  it('ignores whitespace and Unicode form, not wording', () => {
    expect(sourceHash('Pro 买断 · 3 台设备')).toBe(sourceHash('  Pro  买断 ·\n3 台设备 '));
    expect(sourceHash('é')).toBe(sourceHash('é'));
    expect(sourceHash('Pro 买断')).not.toBe(sourceHash('Pro 年付'));
    expect(normalizeSource(' a \t b ')).toBe('a b');
    expect(sourceHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('decide (freshness rule)', () => {
  const tm = { targetText: 'Pro lifetime license', score: 92 };
  const hash = 'h-now';

  it('translates empty English, or reuses a memory hit without a model call', () => {
    expect(decide({ hash, en: '' }, undefined, undefined, false)).toBe('translate');
    expect(decide({ hash, en: '  ' }, tm, undefined, false)).toBe('reuse');
  });

  it('treats English equal to the memory text for the current zh as fresh', () => {
    expect(decide({ hash, en: 'Pro lifetime license' }, tm, new Set([hash]), false)).toBe('fresh');
    expect(decide({ hash, en: 'Pro lifetime license' }, tm, new Set([hash]), true)).toBe('fresh');
  });

  it('retranslates English we produced for an older zh', () => {
    expect(decide({ hash, en: 'Old text' }, undefined, new Set(['h-old']), false)).toBe(
      'translate',
    );
    expect(decide({ hash, en: 'Old text' }, tm, new Set(['h-old']), false)).toBe('reuse');
  });

  it('keeps human or pre-memory English unless refreshing', () => {
    expect(decide({ hash, en: 'Hand written' }, undefined, undefined, false)).toBe('keep');
    expect(decide({ hash, en: 'Hand written' }, tm, undefined, false)).toBe('keep');
    expect(decide({ hash, en: 'Hand written' }, undefined, undefined, true)).toBe('translate');
    expect(decide({ hash, en: 'Hand written' }, tm, undefined, true)).toBe('reuse');
  });

  it('does not reuse a memory row below the publish score', () => {
    expect(decide({ hash, en: '' }, { targetText: 'x', score: 40 }, undefined, false)).toBe(
      'translate',
    );
  });
});
