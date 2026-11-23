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
import type { Config, Ctx } from './runtime.ts';
import { errorMessage } from './util.ts';
import { missingMerchantEvidence } from './verify.ts';

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
  const { dropped, notes } = candidate.auditInputs;
  const issues = [...audit.issues, ...notes];
  if (gaps.length) issues.push(`缺少对应商家原文：${gaps.join('、')}`);
  if (dropped) issues.push(`${dropped} 条引文未通过原文核验`);
  let action: ShadowDecision['action'] = 'manual_review';
  if (!gaps.length && !dropped && !notes.length) {
    if ((audit.verdict === 'reject' && score < policy.rejectBelow) || audit.dims.relevance < 50)
      action = 'auto_reject';
    else if (
      audit.verdict === 'approve' &&
      score >= policy.minScore &&
      candidate.confidence >= 0.8 &&
      !issues.length
    )
      action = 'auto_approve';
  }
  return { action, score, issues, summary: audit.summary };
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
