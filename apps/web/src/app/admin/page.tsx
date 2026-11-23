import Link from 'next/link';
import { FilterLinks } from '@/components/admin/filter-links';
import { fmtTime, KIND_BADGE, SHADOW_LABEL, STATUS_LABEL } from '@/components/admin/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listProposals, PROPOSAL_STATUSES, proposalCounts } from './queries';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { status: raw } = await searchParams;
  const status = PROPOSAL_STATUSES.find((s) => s === raw) ?? 'pending';
  const [rows, counts] = await Promise.all([listProposals(status), proposalCounts()]);

  return (
    <div className="space-y-4">
      <FilterLinks
        items={PROPOSAL_STATUSES.map((s) => ({
          label: STATUS_LABEL[s] ?? s,
          href: s === 'pending' ? '/admin' : `/admin?status=${s}`,
          active: s === status,
          count: counts[s] ?? 0,
        }))}
      />
      {rows.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          {status === 'pending' ? '没有待审核的提案。' : '暂无记录。'}
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableHead>产品</TableHead>
                <TableHead>活动</TableHead>
                <TableHead className="min-w-64">原因</TableHead>
                <TableHead className="text-right">置信度</TableHead>
                <TableHead className="text-right">变更 / 证据</TableHead>
                <TableHead>审校 / 审批</TableHead>
                <TableHead>提交时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant={KIND_BADGE[r.kind].variant}>{KIND_BADGE[r.kind].label}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/proposals/${r.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.productName ?? `提案 #${r.id}`}
                    </Link>
                  </TableCell>
                  <TableCell>{r.eventName ?? '—'}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                    {r.reason}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.confidence === null ? '—' : `${Math.round(r.confidence * 100)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.changeCount} / {r.evidenceCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {r.shadowDecision && (
                        <Badge variant="outline">{SHADOW_LABEL[r.shadowDecision.action]}</Badge>
                      )}
                      {status !== 'pending' && (
                        <span>{r.reviewedBy === 'ai' ? 'AI 自动审批' : '人工审批'}</span>
                      )}
                      {status === 'pending' && r.reviewNote && <span>{r.reviewNote}</span>}
                      {status === 'approved' && r.dealId && (
                        <Link href={`/admin/deals/${r.dealId}`} className="underline">
                          查看优惠
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
