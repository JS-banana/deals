import { describe, expect, it } from 'vitest';
import {
  GLOSSARY,
  GLOSSARY_VERSION,
  glossaryBlock,
  glossaryIssues,
  selectGlossary,
} from './glossary.ts';

const entries = [
  { zh: '年付', en: ['annual plan', 'billed annually'] },
  { zh: '首年', en: ['first year'] },
  { zh: '礼品卡', en: ['gift card'] },
];

describe('glossary', () => {
  it('selects only entries whose Chinese term occurs in the batch', () => {
    expect(selectGlossary(['Solo 年付 · 首年'], entries).map((e) => e.zh)).toEqual([
      '年付',
      '首年',
    ]);
    expect(selectGlossary(['Pro 买断', '礼品卡可用'], entries).map((e) => e.zh)).toEqual([
      '礼品卡',
    ]);
    expect(selectGlossary(['无术语'], entries)).toEqual([]);
  });

  it('reports a missing term case-insensitively and accepts any allowed variant', () => {
    const zh = 'Solo 年付 · 首年';
    expect(glossaryIssues(zh, 'Solo Annual Plan · First Year', entries)).toEqual([]);
    expect(glossaryIssues(zh, 'Solo billed annually · first year', entries)).toEqual([]);
    const issues = glossaryIssues(zh, 'Solo yearly · first year', entries);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('年付');
  });

  it('renders a prompt block only when something applies', () => {
    expect(glossaryBlock([])).toBe('');
    expect(glossaryBlock(entries.slice(0, 1))).toContain('年付 -> annual plan | billed annually');
  });

  it('ships a versioned, well-formed glossary', () => {
    expect(GLOSSARY_VERSION).toBeTruthy();
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(30);
    for (const entry of GLOSSARY) {
      expect(entry.zh).toBeTruthy();
      expect(entry.en.length).toBeGreaterThan(0);
    }
    expect(new Set(GLOSSARY.map((e) => e.zh)).size).toBe(GLOSSARY.length);
  });
});
