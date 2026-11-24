import type { Deal } from '@deals/core';
import type { Evidence } from '@deals/db';
import { describe, expect, it } from 'vitest';
import { type AuditCandidate, type AuditResult, decideProposal, shouldExecute } from './audit.ts';
import { replayMetrics } from './audit-eval.ts';
import {
  AUDIT_SYSTEM,
  auditUser,
  EXTRACT_SYSTEM,
  extractSystem,
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

describe('curated approvals', () => {
  const curated: AuditCandidate = {
    ...candidate,
    auditInputs: { ...candidate.auditInputs, sourceTrust: 'curated' },
  };
  const curatedRow: AuditCandidate = {
    ...curated,
    auditInputs: { ...curated.auditInputs, upstreamText: page },
    evidence: evidence.map((quote) => ({ ...quote, url: upstream })),
  };
  const merchantText = 'Explore the Pro plan.';

  it('approves verbatim curated-list facts with the community-sourced tier', () => {
    expect(decide(audit, curatedRow, merchantText)).toMatchObject({
      action: 'auto_approve',
      verified: false,
      issues: [],
    });
  });

  it('prefers the merchant-verified tier when all fields have merchant evidence', () => {
    expect(decide(audit, curated)).toMatchObject({ action: 'auto_approve', verified: true });
  });

  it.each([
    { kept: 10, dropped: 1, merchantOnly: true, approve: true },
    { kept: 8, dropped: 4, merchantOnly: false, approve: true },
    { kept: 8, dropped: 4, merchantOnly: true, approve: false },
    { kept: 4, dropped: 3, merchantOnly: false, approve: false },
    { kept: 10, dropped: 5, merchantOnly: false, approve: false },
  ])(
    'checks $kept kept/$dropped dropped with merchantOnly=$merchantOnly',
    ({ kept, dropped, merchantOnly, approve }) => {
      const extra = ['Pro plan', 'Redeem at checkout', 'Online purchase', 'Instant access'];
      const text = [page, ...extra].join('\n');
      const url = merchantOnly ? merchant : upstream;
      const item = {
        ...curated,
        evidence: [
          ...evidence.map((e) => ({ ...e, url })),
          ...extra.map((quote) => ({ field: 'terms', url, quote })),
        ].slice(0, kept),
        auditInputs: { ...curated.auditInputs, dropped, upstreamText: merchantOnly ? '' : text },
      };
      const source = merchantOnly ? text : merchantText;
      const decision = decide(audit, item, source);
      if (approve) {
        expect(decision).toMatchObject({
          action: 'auto_approve',
          verified: merchantOnly,
          issues: [],
        });
        expect(decide({ ...audit, verdict: 'reject', score: 45 }, item, source).action).toBe(
          'manual_review',
        );
        const noted = { ...item, auditInputs: { ...item.auditInputs, notes: ['条款存疑'] } };
        expect(decide(audit, noted, source)).toMatchObject({ action: 'manual_review' });
        expect(decide(audit, noted, source).issues).not.toContain(
          `${dropped} 条引文未通过原文核验`,
        );
      } else {
        expect(decision).toMatchObject({
          action: 'manual_review',
          issues: expect.arrayContaining([`${dropped} 条引文未通过原文核验`]),
        });
      }
    },
  );

  it('requires merchant evidence for ordinary community sources and curated updates', () => {
    const { upstreamText } = curatedRow.auditInputs;
    expect(
      decide(
        audit,
        { ...curatedRow, auditInputs: { ...candidate.auditInputs, upstreamText } },
        merchantText,
      ).action,
    ).toBe('manual_review');
    expect(
      decide(
        audit,
        { ...curatedRow, changes: [{ field: 'priceAmount', before: 25, after: 19 }] },
        merchantText,
      ).action,
    ).toBe('manual_review');
  });

  it.each([
    ['priceAmount', 'Regular price $19. Sale price $12.'],
    ['originalAmount', 'Black Friday $19 → $29'],
    ['priceAmount', 'Black Friday CAD $19'],
    ['endsOn', 'Ends December 1, 2025'],
    ['code', 'Use code Save20'],
  ])(
    'flags contradictory %s evidence in missingMerchantEvidence and holds non-curated verification',
    (field, quote) => {
      const claims = evidence.map((e) => (e.field === field ? { field, quote, url: merchant } : e));
      const text = claims.map((e) => e.quote).join('\n');
      const item = { ...candidate, evidence: claims };
      expect(merchantGaps(item, text)).toContain(field);
      expect(decide(audit, item, text).action).toBe('manual_review');
    },
  );

  it('supports dual-currency quotes, weekday dates, multi-price renewals, usually, and Spanish Tier 2 dates', () => {
    const dualCurrency = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, priceAmount: 22.99, originalAmount: 39 },
      },
      evidence: [
        {
          field: 'priceAmount',
          quote: 'Pro lifetime costs $22.99 / 22,99 € instead of $39 / 39 €',
          url: merchant,
        },
        {
          field: 'originalAmount',
          quote: 'Pro lifetime costs $22.99 / 22,99 € instead of $39 / 39 €',
          url: merchant,
        },
      ],
    };
    const dualText = dualCurrency.evidence[0]?.quote ?? '';
    expect(merchantGaps(dualCurrency, dualText)).not.toEqual(
      expect.arrayContaining(['priceAmount', 'originalAmount']),
    );
    const cadItem = {
      ...candidate,
      evidence: evidence.map((e) =>
        e.field === 'priceAmount' ? { field: 'priceAmount', quote: 'CAD $19', url: merchant } : e,
      ),
    };
    expect(merchantGaps(cadItem, cadItem.evidence.map((e) => e.quote).join('\n'))).toContain(
      'priceAmount',
    );

    const weekday = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, startsOn: '2026-11-09', endsOn: '2026-12-03' },
      },
      evidence: [
        {
          field: 'startsOn',
          quote: 'From Mon Nov 9, 2026 at midnight to Tue Dec 1, 2026',
          url: merchant,
        },
        {
          field: 'endsOn',
          quote: 'ends Thursday, Dec 3, 11:59 pm PT',
          url: merchant,
        },
      ],
    };
    expect(merchantGaps(weekday, weekday.evidence.map((e) => e.quote).join('\n'))).not.toEqual(
      expect.arrayContaining(['startsOn', 'endsOn']),
    );
    const foundedWeekday = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, endsOn: '2026-12-03' },
      },
      evidence: [{ field: 'endsOn', quote: 'Founded Thursday, Dec 3, 2026', url: merchant }],
    };
    expect(merchantGaps(foundedWeekday, 'Founded Thursday, Dec 3, 2026')).toContain('endsOn');

    for (const quote of [
      'Yearly $19.99 → $9.99, then $19.99/yr.',
      '**33% OFF** the first year: ~~$29.99~~ **$19.99**, then $29.99/year.',
    ]) {
      const isArrow = quote.includes('→');
      const sale = isArrow ? 9.99 : 19.99;
      const orig = isArrow ? 19.99 : 29.99;
      const renewalItem = {
        ...candidate,
        payload: {
          ...candidate.payload,
          deal: { ...candidate.payload.deal, priceAmount: sale, originalAmount: orig },
        },
        evidence: [
          { field: 'priceAmount', quote, url: merchant },
          { field: 'originalAmount', quote, url: merchant },
        ],
      };
      expect(merchantGaps(renewalItem, quote)).not.toEqual(
        expect.arrayContaining(['priceAmount', 'originalAmount']),
      );
    }

    const regularLicense = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, priceAmount: 150, originalAmount: 250 },
      },
      evidence: [
        {
          field: 'originalAmount',
          quote: 'the Broadcast Regular License is $150 instead of $250',
          url: merchant,
        },
      ],
    };
    expect(
      merchantGaps(regularLicense, 'the Broadcast Regular License is $150 instead of $250'),
    ).not.toContain('originalAmount');

    const usually = {
      ...candidate,
      payload: {
        ...candidate.payload,
        deal: { ...candidate.payload.deal, priceAmount: 67.5, originalAmount: 90 },
      },
      evidence: [{ field: 'originalAmount', quote: '$67.50 usually $90/year', url: merchant }],
    };
    expect(merchantGaps(usually, '$67.50 usually $90/year')).not.toContain('originalAmount');

    const spanishCurated = {
      ...curatedRow,
      evidence: [
        ...curatedRow.evidence.filter((e) => e.field !== 'endsOn'),
        { field: 'endsOn', quote: 'Hasta el 30 de noviembre', url: merchant },
      ],
      payload: {
        ...curatedRow.payload,
        deal: { ...curatedRow.payload.deal, endsOn: '2026-11-30' },
      },
      auditInputs: {
        ...curatedRow.auditInputs,
        dropped: 1,
        upstreamText: `${curatedRow.auditInputs.upstreamText}\nUntil Nov 30, 2026`,
      },
    };
    expect(decide(audit, spanishCurated, 'Hasta el 30 de noviembre')).toMatchObject({
      action: 'auto_approve',
      verified: false,
      issues: [],
    });
  });

  it('keeps an unlabelled currency-qualified price on a curated list eligible', () => {
    const claims = curatedRow.evidence.map((e) =>
      e.field === 'priceAmount' ? { ...e, quote: 'Pro $19' } : e,
    );
    const item = {
      ...curatedRow,
      evidence: claims,
      auditInputs: {
        ...curatedRow.auditInputs,
        dropped: 1,
        upstreamText: claims.map((e) => e.quote).join('\n'),
      },
    };
    expect(decide(audit, item, merchantText)).toMatchObject({
      action: 'auto_approve',
      verified: false,
    });
  });

  it('allows curated proposals with endsAt timestamps and sibling-supported adjacent strikethrough prices', () => {
    const timed = {
      ...curatedRow,
      payload: {
        ...curatedRow.payload,
        deal: { ...curatedRow.payload.deal, endsAt: '2026-12-01T23:59:00-08:00' },
      },
    };
    expect(decide(audit, timed, merchantText)).toMatchObject({
      action: 'auto_approve',
      verified: false,
      issues: [],
    });

    const mopupClaims: Evidence[] = [
      { field: 'plan', quote: 'Black Friday · Half price $9.99 $19.99', url: merchant },
      { field: 'priceAmount', quote: 'Buy once for $9.99', url: merchant },
      { field: 'originalAmount', quote: '$9.99 $19.99', url: merchant },
      { field: 'discountPercent', quote: '**50% OFF** lifetime', url: upstream },
      { field: 'code', quote: 'code BF2026 applied automatically', url: upstream },
      { field: 'endsOn', quote: 'Back to $19.99 after November 30.', url: merchant },
      { field: 'terms', quote: 'One payment, not a subscription.', url: merchant },
      { field: 'billing', quote: 'One payment, not a subscription.', url: merchant },
      { field: 'oneTime', quote: 'One payment, not a subscription.', url: merchant },
      { field: 'noCode', quote: 'code BF2026 applied automatically', url: upstream },
    ];
    const mopupMerchant = mopupClaims
      .filter((e) => e.url === merchant)
      .map((e) => e.quote)
      .join('\n');
    const mopupUpstream = mopupClaims
      .filter((e) => e.url === upstream)
      .map((e) => e.quote)
      .join('\n');
    const mopup = {
      ...curated,
      evidence: mopupClaims,
      auditInputs: { ...curated.auditInputs, dropped: 1, upstreamText: mopupUpstream },
      payload: {
        ...curated.payload,
        deal: {
          ...curated.payload.deal,
          priceAmount: 9.99,
          originalAmount: 19.99,
          discountPercent: 50,
          discountAmount: null,
          code: 'BF2026',
          noCode: true,
          endsOn: '2026-11-30',
          billing: 'one_time' as const,
          oneTime: true,
        },
      },
    };
    expect(decide(audit, mopup, mopupMerchant)).toMatchObject({
      action: 'auto_approve',
      issues: [],
    });
  });

  it('rechecks extra stored quotes before counting them toward merchant verification', () => {
    const item = {
      ...curated,
      evidence: [
        ...curated.evidence,
        { field: 'terms', quote: 'Invented extra terms', url: merchant },
      ],
      auditInputs: { ...curated.auditInputs, dropped: 1 },
    };
    expect(decide(audit, item).action).toBe('manual_review');
  });

  it('holds curated approvals with an ended page, missing quotes, or unsupported amounts and benefits', () => {
    expect(decide(audit, curatedRow, `${merchantText}\nThis offer has ended.`).action).toBe(
      'manual_review',
    );
    expect(decide(audit, curated, `${page}\nThis offer has ended.`).action).toBe('manual_review');
    for (const item of [
      { ...curatedRow, evidence: [] },
      {
        ...curatedRow,
        evidence: [
          ...curatedRow.evidence,
          { field: 'billing', url: upstream, quote: 'Charged yearly' },
        ],
      },
      {
        ...curatedRow,
        payload: { ...curatedRow.payload, deal: { ...curatedRow.payload.deal, priceAmount: 13 } },
      },
      {
        ...curatedRow,
        payload: {
          ...curatedRow.payload,
          deal: {
            ...curatedRow.payload.deal,
            offerType: 'bundle' as const,
            benefitSummary: { zh: '含 30 天试用', en: '' },
          },
        },
      },
    ]) {
      expect(decide(audit, item, merchantText).action).toBe('manual_review');
    }
  });

  it('allows a clean curated rejection based on an explicit low-scoring reject verdict', () => {
    expect(
      decide({ ...audit, verdict: 'reject', score: 59 }, curatedRow, merchantText).action,
    ).toBe('auto_reject');
    expect(
      decide({ ...audit, dims: { ...audit.dims, relevance: 49 } }, curatedRow, merchantText).action,
    ).toBe('auto_approve');
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
    extractSystem(true),
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
  expect(AUDIT_SYSTEM).toContain('up to 60 characters');
  expect(AUDIT_SYSTEM).toContain('leave issues empty whenever verdict is "approve"');
  const userMsg = JSON.parse(
    auditUser(candidate.payload, [], evidence, { url: merchant, text: page }, '', '2026-11-24'),
  );
  expect(userMsg.today).toBe('2026-11-24 (Asia/Shanghai)');
  expect(userMsg).not.toHaveProperty('sourceTrust');
  expect(
    JSON.parse(
      auditUser(
        candidate.payload,
        [],
        evidence,
        { url: merchant, text: page },
        '',
        '2026-11-24',
        'curated',
      ),
    ).sourceTrust,
  ).toBe('curated');
  expect(extractSystem(false)).toBe(EXTRACT_SYSTEM);
});

describe('refined merchant quote matchers', () => {
  function gapsForQuote(fields: Partial<Deal>, quote: string, source = quote) {
    const item = {
      ...candidate,
      payload: { ...candidate.payload, deal: { ...candidate.payload.deal, ...fields } },
      evidence: [
        ...evidence.filter((e) => !Object.hasOwn(fields, e.field)),
        ...Object.keys(fields).map((field) => ({ field, quote, url: merchant })),
      ],
    };
    return merchantGaps(item, `${page}\n${source}`);
  }

  it.each(['Buy once for $9.99', 'Get lifetime for $9.99', 'Promo price $9.99', '黑五价 $9.99'])(
    'accepts a merchant sale price in “%s”',
    (quote) => {
      expect(gapsForQuote({ priceAmount: 9.99 }, quote)).toEqual([]);
    },
  );

  const prices = { priceAmount: 9.99, originalAmount: 19.99 };
  it('checks the source text behind changes of case, omissions and shortened quotes', () => {
    expect(gapsForQuote({ code: 'SAVE20' }, 'Code SAVE20', 'Code save20')).toEqual(['code']);
    expect(
      gapsForQuote({ priceAmount: 19 }, 'Sale price … $19', 'Sale price $12. Regular price $19'),
    ).toEqual(['priceAmount']);
    expect(
      gapsForQuote({ priceAmount: 19 }, 'Sale price … $19', 'Sale price for Pro is $19'),
    ).toEqual([]);
    expect(gapsForQuote({ priceAmount: 19 }, 'Buy once for $19', 'Buy once for $199')).toEqual([
      'priceAmount',
    ]);
    expect(
      gapsForQuote({ endsOn: '2026-11-30' }, 'until November 30', 'until November 30, 2025'),
    ).toEqual(['endsOn']);
  });
  it.each(['Regular lifetime price $19', 'Regular one-time price $19'])(
    'retains the regular role in “%s”',
    (quote) => {
      expect(gapsForQuote({ priceAmount: 19 }, quote)).toEqual(['priceAmount']);
    },
  );
  it.each(['Black Friday · Half price $9.99 $19.99', 'Half price $19.99 $9.99'])(
    'recovers both adjacent prices in “%s”',
    (quote) => {
      expect(gapsForQuote(prices, quote)).toEqual([]);
    },
  );
  it.each([
    'Prices $9.99 $19.99',
    'Sale CAD $19.99 $9.99',
    'Half price $9.99 19.99',
    'Regular price $9.99. Sale price $19.99.',
    'Black Friday $9.99 → $19.99',
    'Sale price $9.99 -> Regular price $19.99',
    'Black Friday: Regular price $9.99 $19.99',
    'Sale price $19.99 $9.99',
    'Black Friday CAD $19.99 → $9.99',
    'Black Friday USD $19.99 → CAD $9.99',
    'Half price $9.99 per seat, other plan $19.99',
  ])('holds unbound, contradictory, or foreign pairs in “%s”', (quote) => {
    expect(gapsForQuote(prices, quote)).toEqual(['priceAmount', 'originalAmount']);
  });

  it.each([
    ['Nov 24 - Dec 1, 2026', '2026-11-24', '2026-12-01'],
    ['November 24–December 1', '2026-11-24', '2026-12-01'],
    ['Nov 18-30, 2026', '2026-11-18', '2026-11-30'],
    ['11月24日至12月1日', '2026-11-24', '2026-12-01'],
    ['Nov 18th ~ Nov 30th', '2026-11-18', '2026-11-30'],
  ])('binds both endpoints of “%s”', (quote, startsOn, endsOn) => {
    expect(gapsForQuote({ startsOn, endsOn }, quote)).toEqual([]);
    expect(gapsForQuote({ startsOn: endsOn, endsOn: startsOn }, quote)).toEqual([
      'startsOn',
      'endsOn',
    ]);
  });
  it.each([
    'Back to $19.99 after November 30.',
    'until November 30',
    'Ends Nov 30th',
    'Expires on November 30th, 2026',
    '30 Nov 2026 ends',
    '截止至 11 月 30 日',
    '截至2026年11月30日',
    'Founded November 30. Offer ends November 30.',
  ])('binds a dated or yearless deadline in “%s”', (quote) => {
    expect(gapsForQuote({ endsOn: '2026-11-30' }, quote)).toEqual([]);
  });
  it.each([
    'Founded November 30, 2026',
    'until November 30, 2025',
    'In 2026, previously valid until November 30',
    'until November 30, 2025. Updated in 2026.',
    'Dec 18-30, 2026',
    'Nov 18-30, 2025',
    '截至2025年11月30日',
  ])('holds an unrelated or incorrect deadline in “%s”', (quote) => {
    expect(gapsForQuote({ endsOn: '2026-11-30' }, quote)).toEqual(['endsOn']);
  });
  it('requires a start role for a standalone date and the full instant for a timed deadline', () => {
    expect(gapsForQuote({ startsOn: '2026-11-24' }, 'Updated Nov 24')).toEqual(['startsOn']);
    expect(gapsForQuote({ endsAt: '2026-11-30T00:00:00Z' }, 'until November 30')).toEqual([
      'endsAt',
    ]);
  });

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

    const insteadQuote = 'The Basic plan is only $29.50 instead of $59.';
    const saveQuote = 'save 50% on all yearly Superlist subscriptions';
    const phraseItem: AuditCandidate = {
      ...candidate,
      evidence: [
        ...evidence.filter(
          (e) => !['priceAmount', 'originalAmount', 'discountPercent'].includes(e.field),
        ),
        { field: 'priceAmount', quote: insteadQuote, url: merchant },
        { field: 'originalAmount', quote: insteadQuote, url: merchant },
        { field: 'discountPercent', quote: saveQuote, url: merchant },
      ],
      payload: {
        ...candidate.payload,
        deal: {
          ...candidate.payload.deal,
          priceAmount: 29.5,
          originalAmount: 59,
          discountPercent: 50,
        },
      },
    };
    expect(merchantGaps(phraseItem, `${page}\n${insteadQuote}\n${saveQuote}`)).toEqual([]);
    expect(
      merchantGaps(
        {
          ...phraseItem,
          payload: {
            ...candidate.payload,
            deal: {
              ...candidate.payload.deal,
              priceAmount: 59,
              originalAmount: 29.5,
              discountPercent: 50,
            },
          },
        },
        `${page}\n${insteadQuote}\n${saveQuote}`,
      ),
    ).toEqual(expect.arrayContaining(['priceAmount', 'originalAmount']));
  });
});
