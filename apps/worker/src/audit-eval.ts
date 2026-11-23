import { and, desc, eq, inArray, isNull, or, pageSnapshots, proposals } from '@deals/db';
import { auditProposal, decideProposal } from './audit.ts';
import type { Ctx } from './runtime.ts';

export interface ReplayOutcome {
  decision: 'auto_approve' | 'auto_reject' | 'manual_review';
  approved: boolean;
  edited: boolean;
}

export function replayMetrics(outcomes: ReplayOutcome[]) {
  const approvals = outcomes.filter((o) => o.decision === 'auto_approve');
  const rejects = outcomes.filter((o) => o.decision === 'auto_reject');
  const rate = (errors: number, total: number) => ({
    errors,
    total,
    rate: total ? errors / total : null,
  });
  return {
    replayable: outcomes.length,
    falseApprovals: rate(approvals.filter((o) => !o.approved || o.edited).length, approvals.length),
    falseRejections: rate(rejects.filter((o) => o.approved).length, rejects.length),
    manual: outcomes.length - approvals.length - rejects.length,
  };
}

/** Deterministic most-recent human sample, including legacy rows so missing coverage is visible. */
export async function auditEval(ctx: Ctx) {
  const rows = await ctx.db
    .select({ proposal: proposals, text: pageSnapshots.text })
    .from(proposals)
    .leftJoin(pageSnapshots, eq(proposals.snapshotId, pageSnapshots.id))
    .where(
      and(
        inArray(proposals.kind, ['create', 'update']),
        inArray(proposals.status, ['approved', 'rejected']),
        or(eq(proposals.reviewedBy, 'human'), isNull(proposals.reviewedBy)),
      ),
    )
    .orderBy(desc(proposals.reviewedAt), desc(proposals.id))
    .limit(ctx.sample ?? 15);
  const outcomes: ReplayOutcome[] = [];
  let missing = 0;
  let unavailable = 0;
  for (const { proposal, text } of rows) {
    if (
      !proposal.payload ||
      !proposal.auditInputs ||
      !text ||
      proposal.confidence === null ||
      (proposal.status === 'approved' &&
        (proposal.reviewEdited === null || !proposal.approvedPayload))
    ) {
      missing++;
      continue;
    }
    const candidate = {
      ...proposal,
      payload: proposal.payload,
      confidence: proposal.confidence,
      auditInputs: proposal.auditInputs,
    };
    const audit = await auditProposal(ctx, candidate, text);
    if (!audit) unavailable++;
    const decision = decideProposal(candidate, text, audit, ctx.config.auto);
    outcomes.push({
      decision: decision.action,
      approved: proposal.status === 'approved',
      edited: proposal.reviewEdited === true,
    });
    ctx.log(
      `#${proposal.id} ${decision.action} / human:${proposal.status}${proposal.reviewEdited ? ' (edited)' : ''}`,
    );
  }
  const metrics = replayMetrics(outcomes);
  const show = (r: typeof metrics.falseApprovals) =>
    r.rate !== null ? `${r.errors}/${r.total} (${(100 * r.rate).toFixed(1)}%)` : '0/0（无样本）';
  ctx.log(
    `人工样本 ${rows.length}；可回放 ${metrics.replayable}；资料缺失 ${missing}；模型失败转人工 ${unavailable}；拟人审 ${metrics.manual}`,
  );
  ctx.log(
    `拟自动发布错单率 ${show(metrics.falseApprovals)}；拟自动拒绝误杀率 ${show(metrics.falseRejections)}`,
  );
}
