import {
  and,
  approveProposal,
  asc,
  desc,
  eq,
  inArray,
  pageSnapshots,
  proposals,
  rejectProposal,
  sql,
} from '@deals/db';
import { type AuditCandidate, auditProposal, decideProposal, shouldExecute } from './audit.ts';
import type { Job } from './runtime.ts';
import { UPSTREAM_REPO } from './upstream.ts';
import { bump } from './util.ts';

const UNCONFIRMED_MERCHANT = '商家域名尚未经独立确认';

export const reviewPending: Job = async (ctx) => {
  const { db, stats } = ctx;
  const pending = db
    .select()
    .from(proposals)
    .where(and(eq(proposals.status, 'pending'), inArray(proposals.kind, ['create', 'update'])))
    .orderBy(asc(proposals.id));
  const rows = await (ctx.limit === undefined ? pending : pending.limit(ctx.limit));

  for (const proposal of rows) {
    ctx.signal.throwIfAborted();
    const { id, kind, payload, evidence, sourceRef } = proposal;
    if (!payload || kind === 'flag') continue;
    const { merchantUrl } = payload.deal;
    const snapshots = () => db.select({ text: pageSnapshots.text }).from(pageSnapshots);
    const [snapshot] = proposal.snapshotId
      ? await snapshots().where(eq(pageSnapshots.id, proposal.snapshotId))
      : [];
    const pageText =
      snapshot?.text ??
      (
        await snapshots()
          .where(and(eq(pageSnapshots.url, merchantUrl), sql`${pageSnapshots.text} is not null`))
          .orderBy(desc(pageSnapshots.fetchedAt), desc(pageSnapshots.id))
          .limit(1)
      )[0]?.text ??
      '';

    let auditInputs = proposal.auditInputs ?? {
      merchantUrl,
      upstreamText: evidence
        .filter((e) => e.url === sourceRef)
        .map((e) => e.quote)
        .join('\n'),
      dropped: 0,
      notes: [],
    };
    let confidence = proposal.confidence ?? 0;
    if (kind === 'create' && sourceRef?.startsWith(`https://github.com/${UPSTREAM_REPO}/`)) {
      const legacy = proposal.auditInputs?.sourceTrust !== 'curated';
      if (proposal.auditInputs?.notes.includes(UNCONFIRMED_MERCHANT)) {
        confidence = Math.min(1, Math.round((confidence + 0.15) * 100) / 100);
      }
      auditInputs = {
        ...auditInputs,
        sourceTrust: 'curated',
        notes: auditInputs.notes.filter((note) => note !== UNCONFIRMED_MERCHANT),
      };
      if (
        legacy &&
        auditInputs.dropped === 0 &&
        auditInputs.notes.length === 0 &&
        confidence >= 0.6 &&
        evidence.some((item) => item.url === sourceRef)
      ) {
        confidence = Math.max(confidence, 0.8);
      }
    }
    const candidate: AuditCandidate = { ...proposal, payload, auditInputs, confidence };
    const audit = await auditProposal(ctx, candidate, pageText);
    const decision = decideProposal(candidate, pageText, audit, ctx.config.auto);
    ctx.log(
      `#${id} ${payload.product.name}: ${decision.action} (${decision.score ?? '—'}) ${[decision.summary, ...decision.issues].join('；')}`,
    );
    bump(stats, `shadow:${decision.action}`);
    if (ctx.dryRun) continue;

    const outcome = await db.transaction(async (tx) => {
      // Lock the pending row before executing so another review cannot replace the decision.
      const [updated] = await tx
        .update(proposals)
        .set({
          shadowDecision: decision,
          auditInputs,
          // Persist the restored confidence alongside the removal of the legacy penalty.
          ...(confidence !== (proposal.confidence ?? 0) ? { confidence } : {}),
        })
        .where(and(eq(proposals.id, id), eq(proposals.status, 'pending')))
        .returning({ id: proposals.id });
      if (!updated) return null;
      if (!shouldExecute(kind, decision, ctx.config.auto)) return 'pendingReview';
      if (decision.action === 'auto_reject') {
        return (await rejectProposal(tx, id, decision.summary, 'ai'))
          ? 'autoRejected'
          : 'pendingReview';
      }
      const result = await approveProposal(tx, id, undefined, decision.summary, 'ai');
      return result.conflict ? 'pendingReview' : 'autoApproved';
    });
    if (outcome) bump(stats, outcome);
  }
};
