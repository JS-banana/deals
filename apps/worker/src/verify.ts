import { type Deal, type DealEvent, dealState } from '@deals/core';
import type { Evidence, FieldChange } from '@deals/db';

/** Lower-risk comparison form: Unicode-folded, markdown markers dropped, whitespace collapsed. */
export function fold(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Source {
  url: string;
  text: string;
}

const MIN_QUOTE_CHARS = 3;

/** Keep only quotes that appear verbatim (after folding) in one of the sources. */
export function verifyEvidence(
  claims: ReadonlyArray<{ field: string; quote: string }>,
  sources: readonly Source[],
): { kept: Evidence[]; dropped: number } {
  const folded = sources.map((s) => ({ url: s.url, text: fold(s.text) }));
  const kept: Evidence[] = [];
  let dropped = 0;
  for (const { field, quote } of claims) {
    const needle = fold(quote);
    const source =
      needle.length >= MIN_QUOTE_CHARS ? folded.find((s) => s.text.includes(needle)) : undefined;
    if (source) kept.push({ field, quote: quote.trim(), url: source.url });
    else dropped++;
  }
  return { kept, dropped };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the amount is written in the text, e.g. 47.4 as "47.40" or 1194 as "1,194". */
export function numberAppears(n: number, text: string): boolean {
  const folded = fold(text);
  const fixed = n.toFixed(2);
  const whole = fixed.endsWith('.00') ? fixed.slice(0, -3) : null;
  const forms = new Set<string>([String(n), fixed]);
  if (whole) forms.add(whole);
  for (const form of [...forms]) {
    const [int = '', frac] = form.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    forms.add(frac === undefined ? grouped : `${grouped}.${frac}`);
    if (frac !== undefined) forms.add(`${int},${frac}`);
  }
  return [...forms].some((form) =>
    new RegExp(`(?<!\\d|\\d[.,])${escapeRe(form)}(?!\\d|[.,]\\d)`).test(folded),
  );
}

/** Case-insensitive whole-token match, so BF26 does not match inside BF2026. */
export function codeAppears(code: string, text: string, exactCase = false): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRe(fold(code))}(?![\\p{L}\\p{N}_])`,
    exactCase ? 'u' : 'iu',
  ).test(fold(text));
}

/**
 * Drop amounts, discounts and codes the sources do not state. Returns the cleaned deal plus
 * a note per removed field so the proposal reason can say what was not verifiable.
 */
export function stripUnverified(deal: Deal, sources: string): { deal: Deal; notes: string[] } {
  const next = { ...deal };
  const notes: string[] = [];
  for (const field of ['priceAmount', 'originalAmount', 'discountAmount'] as const) {
    const value = next[field];
    if (value !== null && !numberAppears(value, sources)) {
      next[field] = null;
      notes.push(`${field} ${value} 未在来源中出现，已清空`);
    }
  }
  if (next.discountPercent !== null && !numberAppears(next.discountPercent, sources)) {
    notes.push(`discountPercent ${next.discountPercent} 未在来源中出现，已清空`);
    next.discountPercent = null;
  }
  if (next.code && !codeAppears(next.code, sources)) {
    notes.push(`优惠码 ${next.code} 未在来源中出现，已清空`);
    next.code = null;
  }
  return { deal: next, notes };
}

type EventWindow = Pick<DealEvent, 'slug' | 'kind' | 'featured' | 'startsOn' | 'endsOn'>;

/** Featured, not-yet-ended seasonal event overlapping the deal's dates; otherwise evergreen. */
export function pickEvent(
  events: readonly EventWindow[],
  deal: Pick<Deal, 'startsOn' | 'endsOn'>,
  today: string,
): string {
  const seasonal = events
    .filter((e) => e.kind === 'seasonal' && e.featured && (e.endsOn === null || e.endsOn >= today))
    .sort((a, b) => (a.startsOn ?? '').localeCompare(b.startsOn ?? ''));
  const hit = seasonal.find(
    (e) =>
      (deal.endsOn ?? '9999-12-31') >= (e.startsOn ?? '0000-01-01') &&
      (deal.startsOn ?? '0000-01-01') <= (e.endsOn ?? '9999-12-31'),
  );
  return hit?.slug ?? events.find((e) => e.kind === 'evergreen')?.slug ?? 'evergreen';
}

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Reject ended offers and null out implausible far-future dates. */
export function checkDates(
  deal: Deal,
  now: Date,
  today: string,
): { deal: Deal; ended: boolean; notes: string[] } {
  const next = { ...deal };
  const notes: string[] = [];
  if (next.startsOn && next.startsOn > addDays(today, 180)) {
    notes.push(`startsOn ${next.startsOn} 过于遥远，已清空`);
    next.startsOn = null;
  }
  if (next.endsOn && next.endsOn > addDays(today, 400)) {
    notes.push(`endsOn ${next.endsOn} 过于遥远，已清空`);
    next.endsOn = null;
  }
  return { deal: next, ended: dealState(next, now) === 'ended', notes };
}

/** Fields the recheck may change, in display order. */
export const VOLATILE_FIELDS = [
  'benefitSummary',
  'howToClaim',
  'estimatedValue',
  'priceAmount',
  'originalAmount',
  'currency',
  'discountPercent',
  'discountAmount',
  'code',
  'noCode',
  'startsOn',
  'endsOn',
  'startsAt',
  'endsAt',
  'dateZone',
  'terms',
  'renewal',
  'eligibility',
] as const satisfies ReadonlyArray<keyof Deal>;

const numericTokens = (text: string) => (text.match(/\d[\d.,]*\d|\d/g) ?? []).sort().join('|');

const same = (field: (typeof VOLATILE_FIELDS)[number], a: unknown, b: unknown): boolean => {
  if (field === 'startsAt' || field === 'endsAt') {
    return (
      a === b || (typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b))
    );
  }
  if (field === 'benefitSummary' || field === 'howToClaim')
    return (a as { zh?: string } | null)?.zh === (b as { zh?: string } | null)?.zh;
  if (field === 'terms' || field === 'renewal' || field === 'eligibility') {
    // Localized text: only the Chinese source counts; English is derived from it.
    const zh = (v: unknown) => (v as { zh: string } | null)?.zh.trim() ?? null;
    const [x, y] = [zh(a), zh(b)];
    if (x === y) return true;
    // A rewrite that keeps every number is rewording, not a changed fact.
    return x !== null && y !== null && numericTokens(x) === numericTokens(y);
  }
  return a === b;
};

/**
 * Merge a re-extraction into the published deal. A null never erases a published value (a missing
 * fact on the page is not evidence it was removed). Returns the merged record and the field diff.
 */
export function mergeVolatile(
  before: Deal,
  extracted: Partial<Record<(typeof VOLATILE_FIELDS)[number], unknown>>,
): { deal: Deal; changes: FieldChange[] } {
  const merged: Record<string, unknown> = { ...before };
  const changes: FieldChange[] = [];
  for (const field of VOLATILE_FIELDS) {
    const after = extracted[field];
    if (after === undefined || after === null) continue;
    // Missing "no code needed" wording is not evidence that the code requirement appeared.
    if (field === 'noCode' && after === false) continue;
    if (same(field, before[field], after)) continue;
    merged[field] = after;
    changes.push({ field, before: before[field], after });
  }
  // A coupon code and noCode are mutually exclusive; the newly stated fact wins.
  if (merged.code && merged.noCode) {
    const codeChanged = changes.some((c) => c.field === 'code');
    merged.noCode = codeChanged ? false : before.noCode;
    const at = changes.findIndex((c) => c.field === 'noCode');
    if (at >= 0) changes.splice(at, 1);
    if (merged.noCode !== before.noCode)
      changes.push({ field: 'noCode', before: before.noCode, after: merged.noCode });
  }
  return { deal: merged as Deal, changes };
}

/** Explicit observations only; questions, conditions and negations require human review. */
export function statesOfferEnded(quote: string): boolean {
  if (
    /[?？]|\b(?:not|never|if|once|when|until|unless|whether|before|after)\b|n't\b|尚未|并未|还没|如果|若|是否/i.test(
      quote,
    )
  )
    return false;
  return /\b(?:offer|sale|deal|promotion|discount|campaign|coupon|code|event)\s+(?:(?:has|is|was)\s+)?(?:now\s+|already\s+)?(?:ended|expired|over|closed|finished|withdrawn|no longer (?:available|valid|accepted))\b|(?:活动|优惠码?|促销|折扣)(?:现已|已经|已)(?:结束|过期|截止|失效|下架)/i.test(
    quote,
  );
}

const PRICE_ROLES = {
  priceAmount:
    /\b(?:now|only|pay|sale price|current price|discounted price)\b|现价|到手价|活动价|售价/i,
  originalAmount: /\b(?:regular|original|was|list price|normally|msrp|rrp)\b|原价|原價/i,
  discountAmount: /\b(?:save|saving|savings)\b|立减|省下|节省/i,
};
const PRICE_ROLE_BOUNDARY = new RegExp(
  `(?=${Object.values(PRICE_ROLES)
    .map((role) => role.source)
    .join('|')})`,
  'i',
);

const SYMBOLS: Record<string, string> = {
  USD: 'US\\$',
  CAD: 'CA\\$|C\\$',
  AUD: 'AU\\$|A\\$',
  EUR: '€',
  GBP: '£',
  CNY: 'CN¥|RMB',
  JPY: 'JP¥',
};
const NON_USD_CURRENCY =
  /\b(?:CAD|AUD|NZD|HKD|SGD|EUR|GBP|CNY|JPY|RMB)\b|(?:CA|AU|NZ|HK|SG|MX|C|A)\$|€|£|¥/i;
const TIMEZONE_PATTERNS: Record<string, RegExp> = {
  UTC: /\b(?:utc|gmt)\b/i,
  'America/Los_Angeles': /\b(?:pacific|pst|pdt|pt)\b|太平洋时间/i,
  'America/New_York': /\b(?:eastern|est|edt|et)\b|美东时间/i,
  'America/Chicago': /\b(?:central|cst|cdt|ct)\b|美中时间/i,
  'Europe/London': /\b(?:gmt|bst|uk time)\b/i,
  'Europe/Berlin': /\b(?:cet|cest)\b/i,
  'Asia/Shanghai': /\b(?:beijing|china standard)\b|北京时间/i,
  'Asia/Tokyo': /\b(?:jst|tokyo)\b|日本时间/i,
  'Asia/Seoul': /\b(?:kst|seoul)\b|韩国时间/i,
};
const NUMERAL = '[0-9]+(?:[.,][0-9]+)*';

/** Match the number attached to the unit. A seat count elsewhere in the quote cannot prove a price. */
function amountWithUnit(value: number, unit: string, quote: string): boolean {
  const pattern = new RegExp(
    `(?<![\\p{L}0-9])(?:${unit})\\s*(${NUMERAL})(?![0-9]|[.,][0-9])|(?<![0-9.,])(${NUMERAL})\\s*(?:${unit})(?![\\p{L}0-9])`,
    'giu',
  );
  const matches = [...quote.matchAll(pattern)];
  return matches.length > 0 && matches.every((m) => numberAppears(value, m[1] ?? m[2] ?? ''));
}

function dateInQuote(value: string, quote: string, start: boolean) {
  // Only accept a date directly attached to a role, or the matching endpoint of a range.
  if (/\b(?:not|previously|formerly|originally)\b|原定|并非|未定/i.test(quote)) return false;
  const role = start
    ? /(?:\b(?:starts?|begins?|from)\b(?:\s+(?:on|at))?|开始(?:于)?|自)\s*[:：]?\s*$/i
    : /(?:\b(?:ends?|expires?|until|through|to)\b(?:\s+(?:on|at))?|截止(?:至|于)?|截至|至)\s*[:：]?\s*$/i;
  const bound = (form: string) => {
    const index = quote.toLowerCase().indexOf(form.toLowerCase());
    if (index < 0 || /\d/.test(quote[index + form.length] ?? '')) return false;
    return (
      role.test(quote.slice(0, index)) ||
      (start ? /^\s*(?:起|开始)/ : /^\s*(?:截止|结束|到期)/).test(quote.slice(index + form.length))
    );
  };
  if (bound(value)) return true;
  if (value.includes('T')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  for (const locale of ['en-US', 'en-GB', 'zh-CN']) {
    for (const month of ['long', 'short'] as const) {
      const form = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month,
        day: 'numeric',
        timeZone: 'UTC',
      }).format(date);
      if (bound(form)) return true;
    }
  }
  return false;
}

// Normalize a small set of unambiguous grant phrases. Unknown conditions stay in the
// fingerprint, so a translation that drops a qualifier or changes a unit requires review.
function supportsBenefit(summary: string, quote: string) {
  const normalize = (s: string) =>
    fold(s)
      .toLowerCase()
      .replace(
        /new (?:customers|users) only|only (?:for )?new (?:customers|users)|仅限新(?:客户|用户)|限新客/g,
        ' NEWONLY ',
      )
      .replace(/([\d,.]+)\s*(?:美元|usd)/g, (_m, n) => `$${n}`)
      .replace(/(?:us\$|usd|美元)/g, '$')
      .replace(/(?:in )?(?:api )?credits?|(?:api\s*)?(?:赠金|试用金)/g, ' CREDIT ')
      .replace(/\bdays?\b|天/g, ' DAY ')
      .replace(/\btokens?\b|词元/g, ' TOKEN ')
      .replace(/get |receive |(?:可)?(?:获赠|获领|获得|领取)|可获/g, '')
      .replace(/[.!。！]$/, '')
      .replace(/[\s，:：;；()（）]/g, '');
  const a = normalize(summary),
    b = normalize(quote);
  return a.length > 0 && a === b;
}

function supports(field: string, deal: Deal, quote: string) {
  switch (field) {
    case 'benefitSummary':
      return !!deal.benefitSummary && supportsBenefit(deal.benefitSummary.zh, quote);
    case 'estimatedValue':
      return (
        deal.estimatedValue !== null &&
        !!deal.currency &&
        /worth|valued at|价值/i.test(quote) &&
        amountWithUnit(
          deal.estimatedValue,
          [deal.currency, SYMBOLS[deal.currency]].filter(Boolean).join('|'),
          quote,
        )
      );
    case 'priceAmount':
    case 'originalAmount':
    case 'discountAmount': {
      const value = deal[field];
      if (value === null || !deal.currency) return false;
      const unit = [deal.currency, SYMBOLS[deal.currency]].filter(Boolean).join('|');
      const allowBareUsd = deal.currency === 'USD' && !NON_USD_CURRENCY.test(quote);
      const effectiveUnit = allowBareUsd ? `${unit}|\\$` : unit;
      const matchesWithUnit = (segment: string, amount: number) =>
        amountWithUnit(amount, effectiveUnit, segment) ||
        (['USD', 'CAD', 'AUD'].includes(deal.currency ?? '') &&
          codeAppears(deal.currency ?? '', segment) &&
          amountWithUnit(amount, '\\$', segment));
      if (field === 'priceAmount' || field === 'originalAmount') {
        const parts = quote.split(/\s*(?:→|->|=>)\s*/);
        if (parts.length === 2) {
          const [beforeText = '', afterText = ''] = parts;
          const orig = deal.originalAmount;
          const sale = deal.priceAmount;
          const arrowRightOk =
            sale !== null &&
            (matchesWithUnit(afterText, sale) ||
              (codeAppears(deal.currency, quote) && amountWithUnit(sale, '\\$', afterText)) ||
              (!/[€£¥$]|\b[A-Z]{3}\b/.test(afterText) && numberAppears(sale, afterText)));
          if (
            orig !== null &&
            sale !== null &&
            orig > sale &&
            (matchesWithUnit(beforeText, orig) ||
              (codeAppears(deal.currency, quote) && amountWithUnit(orig, '\\$', beforeText))) &&
            arrowRightOk
          ) {
            return true;
          }
        }
      }
      // Keep adjacent amounts with their own role: "regular USD 50, now USD 29".
      const clauses = quote.split(PRICE_ROLE_BOUNDARY);
      return clauses.some(
        (clause) => PRICE_ROLES[field].test(clause) && matchesWithUnit(clause, value),
      );
    }
    case 'discountPercent':
      return (
        deal.discountPercent !== null &&
        /\boff\b|discount|saving|折扣|优惠|减免/i.test(quote) &&
        amountWithUnit(deal.discountPercent, '%|percent', quote)
      );
    case 'code':
      return deal.code !== null && codeAppears(deal.code, quote, true);
    case 'startsOn':
    case 'endsOn':
    case 'startsAt':
    case 'endsAt':
      return deal[field] !== null && dateInQuote(deal[field], quote, field.startsWith('starts'));
    case 'observedEndedAt':
      return statesOfferEnded(quote);
    case 'dateZone':
      return (
        deal.dateZone !== null &&
        (quote.includes(deal.dateZone) || (TIMEZONE_PATTERNS[deal.dateZone]?.test(quote) ?? false))
      );
    case 'observedLiveOn':
      return (
        deal.observedLiveOn === deal.checkedOn &&
        /available now|offer is live|sale is live|currently available|即日起|现已开启|正在进行/i.test(
          quote,
        ) &&
        !/not available|no longer|previously|expired|已结束|已过期/i.test(quote)
      );
    case 'currency':
      return deal.currency !== null && codeAppears(deal.currency, quote);
    default:
      // Non-numeric fields still need a field-specific merchant quote; the auditor checks its meaning.
      return true;
  }
}

/** Verify each claim against the exact merchant snapshot, even when replaying stored evidence. */
export function missingMerchantEvidence(
  deal: Deal,
  changes: FieldChange[],
  evidence: Evidence[],
  page: Source,
): string[] {
  const { kept } = verifyEvidence(
    evidence.filter((e) => e.url === page.url),
    [page],
  );
  const fields = new Set<string>(
    [
      'benefitSummary',
      'howToClaim',
      'estimatedValue',
      'priceAmount',
      'originalAmount',
      'discountPercent',
      'discountAmount',
      'code',
      'startsOn',
      'endsOn',
      'startsAt',
      'endsAt',
      'renewal',
      'eligibility',
      'dateZone',
    ].filter((field) => deal[field as keyof Deal] != null),
  );
  if (!changes.length && deal.observedLiveOn) fields.add('observedLiveOn');
  if (deal.billing !== 'other') fields.add('billing');
  for (const field of ['oneTime', 'existingUsers', 'noCode'] as const)
    if (deal[field]) fields.add(field);
  for (const { field } of changes) if (field !== 'checkedOn') fields.add(field);
  const gaps = [...fields].filter(
    (field) => !kept.some((e) => e.field === field && supports(field, deal, fold(e.quote))),
  );
  if (!kept.length && !gaps.length) gaps.push('商家引文');
  return gaps;
}
