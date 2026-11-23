import { dealState } from '@deals/core';
import { toDeal } from '@deals/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fmtMoney,
  fmtTime,
  KIND_BADGE,
  SHADOW_LABEL,
  STATE_LABEL,
  STATUS_LABEL,
  Value,
} from '@/components/admin/format';
import { PayloadPreview } from '@/components/admin/payload-preview';
import { FlagActions, ReviewForm } from '@/components/admin/review-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getDealWithRefs, getProposal } from '../../queries';

export const metadata = { title: '提案详情' };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const proposal = await getProposal(id);
  if (!proposal) notFound();
  const current = proposal.dealId ? await getDealWithRefs(proposal.dealId) : null;

  const { kind, payload, changes, evidence } = proposal;
  const pending = proposal.status === 'pending';
  const title = payload?.product.name ?? current?.product.name ?? `提案 #${id}`;
  const badge = KIND_BADGE[kind];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回队列
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <h1 className="text-xl font-semibold">{title}</h1>
          <Badge variant="outline">{STATUS_LABEL[proposal.status]}</Badge>
        </div>
        <p className="text-sm">{proposal.reason}</p>
        {proposal.shadowDecision && (
          <div className="grid gap-1 text-sm">
            <p>
              {SHADOW_LABEL[proposal.shadowDecision.action]} ·{' '}
              {proposal.shadowDecision.score ?? '无评分'} · {proposal.shadowDecision.summary}
            </p>
            {proposal.shadowDecision.issues.length > 0 && (
              <p>{proposal.shadowDecision.issues.join('；')}</p>
            )}
          </div>
        )}
        {pending && proposal.reviewNote && (
          <p className="text-destructive">{proposal.reviewNote}</p>
        )}
        {!pending && (
          <p className="text-sm">{proposal.reviewedBy === 'ai' ? 'AI 自动审批' : '人工审批'}</p>
        )}
        <p className="text-xs text-muted-foreground">
          #{id} · 置信度{' '}
          {proposal.confidence === null ? '—' : `${Math.round(proposal.confidence * 100)}%`} · 提交{' '}
          {fmtTime(proposal.createdAt)}
          {proposal.sourceRef && <> · 来源 {proposal.sourceRef}</>}
        </p>
      </div>

      {kind === 'flag' && (
        <section className="space-y-2 rounded-xl border p-4">
          <h2 className="font-medium">受影响的当前优惠</h2>
          {current ? (
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">产品</dt>
              <dd>{current.product.name}</dd>
              <dt className="text-muted-foreground">活动</dt>
              <dd>{current.event.name.zh}</dd>
              <dt className="text-muted-foreground">方案</dt>
              <dd>
                <Value value={current.deal.plan} />
              </dd>
              <dt className="text-muted-foreground">状态</dt>
              <dd>
                {STATUS_LABEL[current.deal.status]} ·{' '}
                {STATE_LABEL[dealState(toDeal(current.deal), new Date())]}
              </dd>
              <dt className="text-muted-foreground">价格</dt>
              <dd>{fmtMoney(current.deal.priceAmount, current.deal.currency)}</dd>
              <dt className="text-muted-foreground">商家链接</dt>
              <dd>
                <Value value={current.deal.merchantUrl} />
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">该提案没有关联的优惠（可能已被删除）。</p>
          )}
          {current && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/admin/deals/${current.deal.id}`} />}
            >
              打开优惠编辑页
            </Button>
          )}
        </section>
      )}

      {kind === 'update' && (
        <section className="space-y-2">
          <h2 className="font-medium">字段变更（{changes.length}）</h2>
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有记录字段级差异。</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">字段</TableHead>
                    <TableHead>当前值</TableHead>
                    <TableHead>提议值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.field}>
                      <TableCell className="align-top font-mono text-xs">{c.field}</TableCell>
                      <TableCell className="bg-destructive/5 align-top whitespace-normal">
                        <Value value={c.before} />
                      </TableCell>
                      <TableCell className="bg-tint-green align-top whitespace-normal text-tint-green-foreground">
                        <Value value={c.after} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {kind === 'create' && payload && (
        <section className="space-y-2">
          <h2 className="font-medium">提议内容预览</h2>
          <PayloadPreview payload={payload} />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">证据（{evidence.length}）</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有附带证据。</p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: evidence has no stable id
              <li key={i} className="rounded-xl border p-3 text-sm">
                <div className="mb-1 font-mono text-xs text-muted-foreground">{e.field}</div>
                <blockquote className="border-l-2 pl-3">{e.quote}</blockquote>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-block text-xs break-all underline underline-offset-2"
                >
                  {e.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {proposal.approvedPayload && (
        <details className="rounded-xl border p-4">
          <summary>实际发布稿</summary>
          <PayloadPreview payload={proposal.approvedPayload} />
        </details>
      )}
      {pending && kind === 'flag' && <FlagActions id={id} canHide={!!current} />}
      {pending && kind !== 'flag' && payload && (
        <ReviewForm id={id} initialPayload={JSON.stringify(payload, null, 2)} />
      )}
      {pending && kind !== 'flag' && !payload && (
        <p className="text-sm text-destructive">该提案缺少 payload，无法发布，只能拒绝。</p>
      )}
      {!pending && (
        <section className="rounded-xl border p-4 text-sm">
          <p>
            已于 {fmtTime(proposal.reviewedAt)} {STATUS_LABEL[proposal.status]}
            {proposal.reviewNote ? `，备注：${proposal.reviewNote}` : '。'}
          </p>
          {proposal.dealId && (
            <Link
              href={`/admin/deals/${proposal.dealId}`}
              className="mt-1 inline-block underline underline-offset-2"
            >
              查看关联优惠
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
