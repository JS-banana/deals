import data from './glossary.json' with { type: 'json' };

export interface GlossaryEntry {
  zh: string;
  /** Allowed English renderings; the first is canonical. */
  en: string[];
  note?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = data.entries;
export const GLOSSARY_VERSION: string = data.version;

/** Entries whose Chinese term occurs in at least one of the texts. */
export function selectGlossary(
  texts: readonly string[],
  entries: readonly GlossaryEntry[] = GLOSSARY,
): GlossaryEntry[] {
  return entries.filter((entry) => texts.some((text) => text.includes(entry.zh)));
}

/** One issue per term that occurs in `zh` but has none of its allowed renderings in `en`. */
export function glossaryIssues(
  zh: string,
  en: string,
  entries: readonly GlossaryEntry[] = GLOSSARY,
): string[] {
  const lower = en.toLowerCase();
  return selectGlossary([zh], entries)
    .filter((entry) => !entry.en.some((variant) => lower.includes(variant.toLowerCase())))
    .map(
      (entry) =>
        `glossary: "${entry.zh}" should appear as ${entry.en.map((v) => `"${v}"`).join(' | ')}`,
    );
}

/** Prompt block listing the selected entries, or '' when none apply. */
export function glossaryBlock(entries: readonly GlossaryEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map(
    (e) => `- ${e.zh} -> ${e.en.join(' | ')}${e.note ? ` (${e.note})` : ''}`,
  );
  return `GLOSSARY (use these renderings; the first is canonical, the others only where context calls for them)\n${lines.join('\n')}`;
}
