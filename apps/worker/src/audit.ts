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
  hasBenefitEvidence,
  missingMerchantEvidence,
  statesOfferEnded,
  stripUnverified,
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
  const gaps = missingMerchantEvidence(
    candidate.payload.deal,
    candidate.changes,
    candidate.evidence,
    { url: candidate.auditInputs.merchantUrl, text: pageText },
  );
  const { dropped, notes, sourceTrust, merchantUrl, upstreamText } = candidate.auditInputs;
  const issues = [...audit.issues, ...notes];
  if (gaps.length) issues.push(`缺少对应商家原文：${gaps.join('、')}`);
  if (dropped) issues.push(`${dropped} 条引文未通过原文核验`);
  const clean = !dropped && !notes.length;
  const curated = sourceTrust === 'curated';
  const curatedCreate = curated && candidate.changes.length === 0;
  const rejected = audit.verdict === 'reject' && score < policy.rejectBelow;
  if (clean && (curated ? rejected : !gaps.length && (rejected || audit.dims.relevance < 50))) {
    return { action: 'auto_reject', score, issues, summary: audit.summary };
  }
  const ended =
    curatedCreate &&
    pageText.split('\n').some((line) => line.length <= 240 && statesOfferEnded(line));
  if (ended) issues.push('商家页明确优惠已结束');
  if (
    clean &&
    !ended &&
    audit.verdict === 'approve' &&
    score >= policy.minScore &&
    candidate.confidence >= 0.8 &&
    !audit.issues.length
  ) {
    if (!gaps.length)
      return { action: 'auto_approve', verified: true, score, issues: [], summary: audit.summary };
    if (curatedCreate && candidate.evidence.length) {
      const deal = candidate.payload.deal;
      const combinedText = [pageText, upstreamText].filter(Boolean).join('\n');
      const quotes = verifyEvidence(candidate.evidence, [
        { url: merchantUrl, text: pageText },
        { url: deal.sourceUrl ?? merchantUrl, text: upstreamText },
      ]);
      if (
        !stripUnverified(deal, combinedText).notes.length &&
        !quotes.dropped &&
        hasBenefitEvidence(deal, quotes.kept)
      ) {
        return {
          action: 'auto_approve',
          verified: false,
          score,
          issues: [],
          summary: audit.summary,
        };
      }
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
