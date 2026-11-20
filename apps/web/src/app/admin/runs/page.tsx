import { fmtDuration, fmtTime } from '@/components/admin/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listRuns } from '../queries';

export const metadata = { title: '运行记录' };

function summarize(stats: Record<string, unknown>) {
  const parts = Object.entries(stats).map(([k, v]) =>
    typeof v === 'object' && v !== null ? `${k}: ${JSON.stringify(v)}` : `${k}: ${String(v)}`,
  );
  return parts.length ? parts.join(' · ') : '—';
}

export default async function RunsPage() {
  const runs = await listRuns();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">运行记录（最近 50 次）</h1>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>统计</TableHead>
              <TableHead>错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.job}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtTime(r.startedAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmtDuration(r.startedAt, r.finishedAt)}
                </TableCell>
                <TableCell>
                  {r.ok === null ? (
                    <Badge variant="secondary">运行中</Badge>
                  ) : r.ok ? (
                    <Badge>成功</Badge>
                  ) : (
                    <Badge variant="destructive">失败</Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-sm whitespace-normal break-words text-xs text-muted-foreground">
                  {summarize(r.stats)}
                </TableCell>
                <TableCell className="max-w-sm whitespace-normal break-words text-xs text-destructive">
                  {r.error ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {runs.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">暂无运行记录。</p>
        )}
      </div>
    </div>
  );
}
