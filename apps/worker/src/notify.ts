import {
  and,
  asc,
  deals,
  desc,
  eq,
  events,
  pipelineRuns,
  products,
  proposals,
  sql,
  syncState,
  webhookSubscriptions,
  withAdvisoryLock,
} from '@deals/db';
import type { Job } from './runtime.ts';
import { errorMessage } from './util.ts';

export type WebhookKind = 'slack' | 'discord' | 'feishu' | 'wecom' | 'dingtalk';
export function webhookBody(kind: WebhookKind, text: string) {
  switch (kind) {
    case 'discord':
      return { content: text, allowed_mentions: { parse: [] } };
    case 'feishu':
      return { msg_type: 'text', content: { text } };
    case 'wecom':
    case 'dingtalk':
      return { msgtype: 'text', text: { content: text } };
    case 'slack':
      return { text };
  }
}

export async function postWebhook(
  url: string,
  kind: WebhookKind,
  text: string,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhookBody(kind, text.slice(0, 1900))),
  });
  if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
  if (kind === 'feishu' || kind === 'wecom' || kind === 'dingtalk') {
    const result = (await response.json()) as Record<string, unknown>;
    if ((result.code ?? result.errcode ?? result.StatusCode) !== 0)
      throw new Error('webhook delivery rejected');
  }
}

export const digest: Job = async (ctx) => {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  const [queue, failed] = await Promise.all([
    ctx.db
      .select({
        id: proposals.id,
        reason: proposals.reason,
        decision: proposals.shadowDecision,
        note: proposals.reviewNote,
      })
      .from(proposals)
      .where(eq(proposals.status, 'pending'))
      .orderBy(desc(proposals.createdAt))
      .limit(8),
    ctx.db
      .select({ job: pipelineRuns.job })
      .from(pipelineRuns)
      .where(
        sql`started_at >= now() - interval '1 day' and (ok = false or coalesce((stats->>'errors')::int,0) > 0 or coalesce((stats->>'failedJobs')::int,0) > 0)`,
      )
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(12),
  ]);
  if (!queue.length && !failed.length) return;
  const message = [
    '好价清单 · 每日异常摘要',
    ...queue.map(
      (p) =>
        `#${p.id} ${(p.note || p.decision?.issues[0] || p.decision?.summary || p.reason).slice(0, 120)}`,
    ),
    ...failed.map((r) => `任务异常 · ${r.job}`),
    ctx.config.siteUrl && new URL('/admin', ctx.config.siteUrl).href,
  ]
    .filter(Boolean)
    .join('\n');
  if (ctx.dryRun) {
    ctx.log(message);
    return;
  }
  try {
    const kind = process.env.NOTIFY_WEBHOOK_KIND || 'slack';
    if (!['slack', 'discord', 'feishu', 'wecom', 'dingtalk'].includes(kind))
      throw new Error('unknown webhook kind');
    await postWebhook(url, kind as WebhookKind, message, ctx.signal);
    ctx.stats.sent = 1;
  } catch (error) {
    ctx.stats.notifyFailed = 1;
    ctx.log(`notification failed: ${errorMessage(error)}`);
  }
};

const groupKinds: WebhookKind[] = ['slack', 'discord', 'feishu', 'wecom', 'dingtalk'];
/** Deliver approved, published offers only. Each channel advances its own cursor after acceptance. */
export const notifyOffers: Job = async (ctx) => {
  for (const kind of groupKinds) {
    const secretName = `GROUP_WEBHOOK_${kind.toUpperCase()}_URL`;
    const url = process.env[secretName];
    if (!url) continue;
    try {
      if (!ctx.dryRun)
        await ctx.db
          .insert(webhookSubscriptions)
          .values({ kind, secretName, enabled: true })
          .onConflictDoNothing();
      const [subscription] = await ctx.db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.secretName, secretName));
      if (subscription && !subscription.enabled) continue;
      const key = `group-webhook:${kind}`;
      await withAdvisoryLock(ctx.db, key, async () => {
        const [row] = await ctx.db.select().from(syncState).where(eq(syncState.key, key));
        const cursor = row?.value as { at: string; id: number } | undefined;
        const rows = await ctx.db
          .select({
            id: proposals.id,
            at: sql<string>`${proposals.reviewedAt}::text`,
            slug: products.slug,
            product: products.name,
            deal: deals,
          })
          .from(proposals)
          .innerJoin(deals, eq(proposals.dealId, deals.id))
          .innerJoin(events, eq(events.id, deals.eventId))
          .innerJoin(products, eq(products.id, deals.productId))
          .where(
            and(
              eq(proposals.kind, 'create'),
              eq(proposals.status, 'approved'),
              eq(proposals.reviewedBy, 'ai'),
              eq(deals.status, 'published'),
              sql`((${proposals.shadowDecision}->>'score')::numeric >= 90 or ${events.featured})`,
              cursor
                ? sql`(${proposals.reviewedAt}, ${proposals.id}) > (${cursor.at}::timestamptz,${cursor.id})`
                : sql`${proposals.reviewedAt} >= now()-interval '1 day'`,
            ),
          )
          .orderBy(asc(proposals.reviewedAt), asc(proposals.id))
          .limit(ctx.limit ?? 20);
        if (!ctx.config.siteUrl) throw new Error('SITE_URL is required for group offers');
        for (const item of rows) {
          const link = new URL(`/zh/p/${item.slug}`, ctx.config.siteUrl);
          link.searchParams.set('offer', String(item.deal.id));
          const message = [
            item.product,
            item.deal.benefitSummary?.zh ?? item.deal.plan.zh,
            item.deal.code,
            link.href,
          ]
            .filter(Boolean)
            .join('\n');
          if (ctx.dryRun) {
            ctx.log(message);
            continue;
          }
          await postWebhook(url, kind, message, ctx.signal);
          const value = { at: item.at, id: item.id };
          // Commit the acknowledgement per message even when a later delivery fails.
          await ctx.db
            .insert(syncState)
            .values({ key, value })
            .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
          ctx.stats.sent = (ctx.stats.sent ?? 0) + 1;
        }
      });
    } catch (error) {
      ctx.signal.throwIfAborted();
      ctx.stats.notifyFailed = (ctx.stats.notifyFailed ?? 0) + 1;
      ctx.log(`${kind}: ${errorMessage(error)}`);
    }
  }
};
