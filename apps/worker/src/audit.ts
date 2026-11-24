import type {
  AuditInputs,
  Evidence,
  FieldChange,
  ProposalPayload,
  ShadowDecision,
} from '@deals/db';
import { z } from 'zod';
import { zodParse } from './llm.ts';
import { AUDIT_SYSTEM, auditUser } from './prompts.ts';
import { type Config, type Ctx, today } from './runtime.ts';
import { errorMessage } from './util.ts';
import {
  dropRateAcceptable,
  hasBenefitEvidence,
  missingMerchantEvidence,
  statesOfferEnded,
  stripUnverified,
  supportsCuratedGaps,
  verifyEvidence,
} from './verify.ts';

const score = z.number().min(0).max(100);
const auditSchema = z.object({
  verdict: z.enum(['approve', 'review', 'reject']),
  score,
  dims: z.object({ accuracy: score, billingAndTerms: score, relevance: score, copyQuality: score }),
  issues: z.array(z.string()),
  summary: z.string().trim().min(1),
});
export type AuditResult = z.infer<typeof auditSchema>;
export interface AuditCandidate {
  payload: ProposalPayload;
  changes: FieldChange[];
  evidence: Evidence[];
  confidence: number;
  auditInputs: AuditInputs;
}

export async function auditProposal(ctx: Ctx, candidate: AuditCandidate, pageText: string) {
  const { payload, changes, evidence, auditInputs } = candidate;
  try {
    return await ctx.reviewLlm.json({
      system: AUDIT_SYSTEM,
      user: auditUser(
        payload,
        changes,
        evidence,
        { url: auditInputs.merchantUrl, text: pageText },
        auditInputs.upstreamText,
        payload.deal.checkedOn || today(),
        auditInputs.sourceTrust,
      ),
      reasoningEffort: 'medium',
      parse: zodParse(auditSchema),
    });
  } catch (error) {
    ctx.signal.throwIfAborted();
    ctx.log(`audit failed: ${errorMessage(error)}`);
    return null;
  }
}

export function decideProposal(
  candidate: AuditCandidate,
  pageText: string,
  audit: AuditResult | null,
  policy: Config['auto'],
): ShadowDecision {
  if (!audit)
    return { action: 'manual_review', score: null, summary: '审校模型不可用', issues: [] };
  const score = Math.min(audit.score, audit.dims.accuracy, audit.dims.billingAndTerms);
  const { dropped, notes, sourceTrust, merchantUrl, upstreamText } = candidate.auditInputs;
  const merchant = { url: merchantUrl, text: pageText };
  const gaps = missingMerchantEvidence(
    candidate.payload.deal,
    candidate.changes,
    candidate.evidence,
    merchant,
  );
  const issues = [...audit.issues, ...notes];
  if (gaps.length) issues.push(`缺少对应商家原文：${gaps.join('、')}`);
  const curated = sourceTrust === 'curated';
  const curatedCreate = curated && candidate.changes.length === 0;
  const tier = curatedCreate
    ? gaps.length
      ? 'curated_community'
      : 'curated_verified'
    : 'standard';
  const acceptableDrops = dropRateAcceptable(candidate.evidence.length, dropped, tier);
  if (dropped > 0 && !acceptableDrops) issues.push(`${dropped} 条引文未通过原文核验`);
  const rejected = audit.verdict === 'reject' && score < policy.rejectBelow;
  if (
    !dropped &&
    !notes.length &&
    (curated ? rejected : !gaps.length && (rejected || audit.dims.relevance < 50))
  ) {
    return { action: 'auto_reject', score, issues, summary: audit.summary };
  }
  const ended =
    curatedCreate &&
    pageText.split('\n').some((line) => line.length <= 240 && statesOfferEnded(line));
  if (ended) issues.push('商家页明确优惠已结束');
  if (
    acceptableDrops &&
    !notes.length &&
    !ended &&
    audit.verdict === 'approve' &&
    score >= policy.minScore &&
    candidate.confidence >= 0.8 &&
    !audit.issues.length
  ) {
    const deal = candidate.payload.deal;
    const upstream = { url: deal.sourceUrl ?? merchantUrl, text: upstreamText };
    const quotes = verifyEvidence(candidate.evidence, [merchant, upstream]);
    if (quotes.dropped) {
      issues.push('留存引文与审校原文不符');
    } else if (
      !gaps.length ||
      (curatedCreate &&
        quotes.kept.length &&
        !stripUnverified(deal, [pageText, upstreamText].join('\n')).notes.length &&
        hasBenefitEvidence(deal, quotes.kept) &&
        supportsCuratedGaps(deal, gaps, quotes.kept, merchant, upstreamText))
    ) {
      return {
        action: 'auto_approve',
        verified: !gaps.length,
        score,
        issues: [],
        summary: audit.summary,
      };
    }
  }
  return { action: 'manual_review', score, issues, summary: audit.summary };
}

export function shouldExecute(
  kind: 'create' | 'update',
  decision: ShadowDecision,
  policy: Config['auto'],
) {
  return decision.action === 'auto_approve'
    ? policy[kind]
    : decision.action === 'auto_reject' && policy.reject;
}
