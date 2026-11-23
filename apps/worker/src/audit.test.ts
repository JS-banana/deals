import type { Evidence } from '@deals/db';
import { describe, expect, it } from 'vitest';
import { type AuditCandidate, type AuditResult, decideProposal, shouldExecute } from './audit.ts';
import { replayMetrics } from './audit-eval.ts';
import {
  AUDIT_SYSTEM,
  auditUser,
  EXTRACT_SYSTEM,
  RECHECK_SYSTEM,
  reviewSystem,
  reviseSystem,
  translateSystem,
} from './prompts.ts';
import { loadConfig } from './runtime.ts';
import { missingMerchantEvidence } from './verify.ts';

function merchantGaps(item: AuditCandidate, text: string) {
  return missingMerchantEvidence(item.payload.deal, item.changes, item.evidence, {
    url: item.auditInputs.merchantUrl,
    text,
  });
}

const policy = loadConfig({}).auto;
const merchant = 'https://shop.example/sale';
const upstream = 'https://community.example/item';
const evidence: Evidence[] = [
  { field: 'priceAmount', quote: 'Pro now USD 19', url: merchant },
  { field: 'originalAmount', quote: 'regular USD 29', url: merchant },
  { field: 'discountPercent', quote: '20% off', url: merchant },
  { field: 'discountAmount', quote: 'save 10 USD', url: merchant },
  { field: 'code', quote: 'enter SAVE20', url: merchant },
  { field: 'endsOn', quote: 'Ends December 1, 2026', url: merchant },
];
const page = evidence.map((e) => e.quote).join('\n');
const candidate: AuditCandidate = {
  auditInputs: { merchantUrl: merchant, upstreamText: 'Pro USD 300', dropped: 0, notes: [] },
  evidence,
  changes: [],
  confidence: 0.8,
  payload: {
    product: {
      slug: 'pro',
      name: 'Pro',
      website: merchant,
      logoPath: null,
      category: 'ai',
      summary: { zh: '工具', en: '' },
    },
    event: 'evergreen',
    deal: {
      plan: { zh: '专业版', en: '' },
      priceAmount: 19,
      originalAmount: 29,
      currency: 'USD',
      billing: 'other',
      discountPercent: 20,
      discountAmount: 10,
      code: 'SAVE20',
      noCode: false,
      startsOn: null,
      endsOn: '2026-12-01',
      startsAt: null,
      endsAt: null,
      dateZone: null,
      observedLiveOn: null,
      offerKey: 'default',
      offerType: 'discount',
      estimatedValue: null,
      benefitSummary: null,
      howToClaim: null,
      observedEndedAt: null,
      oneTime: false,
      existingUsers: false,
      terms: { zh: '条款', en: '' },
      renewal: null,
      eligibility: null,
      cardNote: null,
      merchantUrl: merchant,
      sourceUrl: upstream,
      verified: false,
      checkedOn: '2026-11-20',
    },
  },
};
const audit: AuditResult = {
  verdict: 'approve',
  score: 85,
  dims: { accuracy: 99, billingAndTerms: 99, relevance: 90, copyQuality: 90 },
  issues: [],
  summary: '核验通过',
};
const decide = (result: AuditResult | null, item = candidate, text = page) =>
  decideProposal(item, text, result, policy);

describe('merchant field evidence', () => {
  it('matches the type, value, unit, source and deadline for every populated quote field', () => {
    expect(merchantGaps(candidate, page)).toEqual([]);
    for (const { field } of evidence) {
      const communityOnly = {
        ...candidate,
        evidence: evidence.map((e) => (e.field === field ? { ...e, url: upstream } : e)),
      };
      expect(merchantGaps(communityOnly, page)).toEqual([field]);
      expect(decide(audit, communityOnly).action).toBe('manual_review');
    }
  });
  it.each([
    ['priceAmount', '30-day trial, 19 seats for EUR 19'],
    ['priceAmount', '19 seats for USD 12'],
    ['priceAmount', 'USD 119'],
    ['originalAmount', 'regular EUR 29'],
    ['discountPercent', '20 seats for 5% off'],
    ['discountPercent', 'VAT 20%'],
    ['discountAmount', 'save USD 100'],
    ['code', 'enter SAVE200'],
    ['code', 'enter Save20'],
    ['endsOn', 'Ends December 10, 2026'],
    ['endsOn', 'Sale starts December 1, 2026'],
    ['endsOn', 'Sale starts December 1, 2026 and ends December 31, 2026'],
  ])('a matching quote cannot certify an unrelated or incorrect %s', (field, quote) => {
    const quotes = evidence.map((e) => (e.field === field ? { ...e, quote } : e));
    const item = { ...candidate, evidence: quotes };
    expect(merchantGaps(item, quotes.map((e) => e.quote).join('\n'))).toContain(field);
  });
  it('binds regular and sale prices in the same quote to their respective roles', () => {
    const quote = 'Regular price USD 50. Sale price USD 29.';
    const item = {
      ...candidate,
      evidence: [
        ...candidate.evidence.filter((e) => !['priceAmount', 'originalAmount'].includes(e.field)),
        ...['priceAmount', 'originalAmount'].map((field) => ({ field, quote, url: merchant })),
      ],
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, priceAmount: 29, originalAmount: 50 },
      },
    };
    const text = `${page}\n${quote}`;
    expect(merchantGaps(item, text)).toEqual([]);
    expect(
      merchantGaps(
        { ...item, payload: { ...item.payload, deal: { ...item.payload.deal, priceAmount: 50 } } },
        text,
      ),
    ).toContain('priceAmount');
  });
  it('requires the merchant timezone and current availability when publishing an observed start', () => {
    const item = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: {
          ...candidate.payload.deal,
          dateZone: 'Pacific/Honolulu',
          observedLiveOn: '2026-11-20',
        },
      },
    };
    expect(merchantGaps(item, page).sort()).toEqual(['dateZone', 'observedLiveOn']);
  });
  it.each([
    'This offer is not over.',
    'Over 50 apps included.',
    'If this offer has ended, contact us.',
  ])('holds ambiguous end evidence: %s', (quote) => {
    const item = {
      ...candidate,
      changes: [{ field: 'observedEndedAt', before: null, after: '2026-12-01T00:00:00Z' }],
      evidence: [...evidence, { field: 'observedEndedAt', quote, url: merchant }],
    };
    expect(merchantGaps(item, `${page}\n${quote}`)).toContain('observedEndedAt');
  });
  it('rechecks stored quotes against the snapshot body', () => {
    expect(merchantGaps(candidate, page.replace('USD 19', 'USD 99'))).toContain('priceAmount');
  });
  it('requires merchant evidence for the observed end of this offer and other reviewed changes', () => {
    const item = {
      ...candidate,
      changes: [{ field: 'observedEndedAt', before: null, after: '2026-12-01T00:00:00Z' }],
    };
    expect(merchantGaps(item, page)).toEqual(['observedEndedAt']);
    const quote = 'This Pro offer has ended.';
    expect(
      merchantGaps(
        { ...item, evidence: [...evidence, { field: 'observedEndedAt', quote, url: merchant }] },
        `${page}\n${quote}`,
      ),
    ).toEqual([]);
  });
});

describe('shadow decisions and execution', () => {
  it('predicts with all switches off and executes only the enabled operation', () => {
    const decision = decide(audit);
    expect(decision.action).toBe('auto_approve');
    expect(shouldExecute('create', decision, policy)).toBe(false);
    expect(shouldExecute('update', decision, { ...policy, create: true })).toBe(false);
    expect(shouldExecute('create', decision, { ...policy, create: true })).toBe(true);
    expect(shouldExecute('update', decision, { ...policy, update: true })).toBe(true);
    const reject = decide({ ...audit, verdict: 'reject', score: 59 });
    expect(reject.action).toBe('auto_reject');
    expect(shouldExecute('create', reject, { ...policy, create: true })).toBe(false);
    expect(shouldExecute('update', reject, { ...policy, reject: true })).toBe(true);
    expect(shouldExecute('create', decide(null), { ...policy, create: true, reject: true })).toBe(
      false,
    );
  });
  it('honors score boundaries, component caps and the model failure fallback', () => {
    expect(decide({ ...audit, score: 84 }).action).toBe('manual_review');
    expect(decide({ ...audit, dims: { ...audit.dims, accuracy: 73 } })).toMatchObject({
      action: 'manual_review',
      score: 73,
    });
    expect(decide({ ...audit, verdict: 'reject', score: 60 }).action).toBe('manual_review');
    expect(decide({ ...audit, dims: { ...audit.dims, relevance: 49 } }).action).toBe('auto_reject');
    expect(decide(null)).toMatchObject({ action: 'manual_review', score: null });
  });
  it('keeps model issues, discarded evidence, deterministic notes and low confidence in review', () => {
    expect(decide({ ...audit, issues: ['计费周期存疑'] }).action).toBe('manual_review');
    expect(decide(audit, { ...candidate, confidence: 0.79 }).action).toBe('manual_review');
    for (const change of [{ dropped: 1 }, { notes: ['原价未核实'] }]) {
      expect(
        decide(audit, { ...candidate, auditInputs: { ...candidate.auditInputs, ...change } })
          .action,
      ).toBe('manual_review');
    }
  });
});

it('measures edited approvals, rejected good offers and abstentions with separate denominators', () => {
  expect(
    replayMetrics([
      { decision: 'auto_approve', approved: true, edited: true },
      { decision: 'auto_approve', approved: true, edited: false },
      { decision: 'auto_reject', approved: true, edited: true },
      { decision: 'manual_review', approved: false, edited: false },
    ]),
  ).toEqual({
    replayable: 4,
    falseApprovals: { errors: 1, total: 2, rate: 0.5 },
    falseRejections: { errors: 1, total: 1, rate: 1 },
    manual: 1,
  });
  expect(replayMetrics([]).falseApprovals.rate).toBeNull();
});

it('includes JSON in every json_object system prompt and documents default-false flags in audit', () => {
  for (const prompt of [
    EXTRACT_SYSTEM,
    RECHECK_SYSTEM,
    AUDIT_SYSTEM,
    translateSystem(''),
    reviseSystem(''),
    reviewSystem(''),
  ]) {
    expect(prompt).toMatch(/\bjson\b/i);
  }
  expect(AUDIT_SYSTEM).toContain('noCode, oneTime, existingUsers');
  expect(AUDIT_SYSTEM).toContain('default to false when unstated');
  expect(AUDIT_SYSTEM).toContain('The "today" field');
  const userMsg = JSON.parse(
    auditUser(candidate.payload, [], evidence, { url: merchant, text: page }, '', '2026-11-24'),
  );
  expect(userMsg.today).toBe('2026-11-24 (Asia/Shanghai)');
});

describe('refined merchant quote matchers', () => {
  it('accepts natural timezone phrases while rejecting unrelated zones', () => {
    const quote = 'ends Dec 1 at 11:59 pm Pacific';
    const item = {
      ...candidate,
      evidence: [...evidence, { field: 'dateZone', quote, url: merchant }],
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, dateZone: 'America/Los_Angeles' },
      },
    };
    expect(merchantGaps(item, `${page}\n${quote}`)).toEqual([]);
    expect(
      merchantGaps(
        {
          ...item,
          payload: {
            ...candidate.payload,
            deal: { ...candidate.payload.deal, dateZone: 'Pacific/Honolulu' },
          },
        },
        `${page}\n${quote}`,
      ),
    ).toContain('dateZone');
  });

  it('accepts price transitions and bare USD symbols while rejecting swapped or foreign currencies', () => {
    const arrowQuote = 'Code BLACKFRIDAY26 at checkout: $29 → $20.30';
    const arrowItem: AuditCandidate = {
      ...candidate,
      evidence: [
        ...evidence.filter((e) => !['priceAmount', 'originalAmount'].includes(e.field)),
        { field: 'priceAmount', quote: arrowQuote, url: merchant },
        { field: 'originalAmount', quote: arrowQuote, url: merchant },
      ],
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, priceAmount: 20.3, originalAmount: 29 },
      },
    };
    expect(merchantGaps(arrowItem, `${page}\n${arrowQuote}`)).toEqual([]);
    expect(
      merchantGaps(arrowItem, `${page}\nCode BLACKFRIDAY26 at checkout: $20.30 → $29`),
    ).toEqual(expect.arrayContaining(['priceAmount', 'originalAmount']));
    expect(
      merchantGaps(arrowItem, `${page}\nCode BLACKFRIDAY26 at checkout: CAD $29 → $20.30`),
    ).toEqual(expect.arrayContaining(['priceAmount', 'originalAmount']));

    const bareUsd = 'Sale price $19';
    const bareItem: AuditCandidate = {
      ...candidate,
      evidence: evidence.map((e) => (e.field === 'priceAmount' ? { ...e, quote: bareUsd } : e)),
    };
    expect(merchantGaps(bareItem, `${page}\n${bareUsd}`)).toEqual([]);
    for (const bad of [
      'Sale price CAD $19',
      'Sale price CA$19',
      'Regular price $19. Sale price $12.',
    ]) {
      expect(
        merchantGaps(
          {
            ...bareItem,
            evidence: evidence.map((e) => (e.field === 'priceAmount' ? { ...e, quote: bad } : e)),
          },
          `${page}\n${bad}`,
        ),
      ).toContain('priceAmount');
    }
  });
});
