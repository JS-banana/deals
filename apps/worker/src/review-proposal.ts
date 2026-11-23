import { approveProposal, fileProposal, rejectProposal } from '@deals/db';
import { type AuditCandidate, auditProposal, decideProposal, shouldExecute } from './audit.ts';
import type { Ctx } from './runtime.ts';
import { bump } from './util.ts';

type Submission = AuditCandidate & {
  kind: 'create' | 'update';
  snapshotId: number | null;
  dealId?: number;
  reason: string;
  dedupeKey: string;
  sourceRef: string;
};

/** Persist the exact inputs and shadow decision together before attempting a real transition. */
export async function reviewProposal(
  ctx: Ctx,
  proposal: Submission,
  pageText: string,
): Promise<boolean> {
  const audit = await auditProposal(ctx, proposal, pageText);
  const decision = decideProposal(proposal, pageText, audit, ctx.config.auto);
  ctx.log(
    `${proposal.payload.product.name}: ${decision.action} (${decision.score ?? '—'}) ${[decision.summary, ...decision.issues].join('；')}`,
  );
  bump(ctx.stats, `shadow:${decision.action}`);
  if (ctx.dryRun) return true;
  if (!proposal.snapshotId) throw new Error('proposal requires a stored merchant snapshot');
  const result = await ctx.db.transaction(async (tx) => {
    const id = await fileProposal(tx, { ...proposal, shadowDecision: decision });
    if (id === null) return null;
    if (!shouldExecute(proposal.kind, decision, ctx.config.auto)) return 'pendingReview';
    if (decision.action === 'auto_reject') {
      if (!(await rejectProposal(tx, id, decision.summary, 'ai')))
        throw new Error('proposal rejection failed');
      return 'autoRejected';
    }
    const published = await approveProposal(tx, id, undefined, decision.summary, 'ai');
    return published.conflict ? 'pendingReview' : 'autoApproved';
  });
  if (result === null) return false;
  bump(ctx.stats, result);
  return true;
}
