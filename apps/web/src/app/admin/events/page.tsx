import { toEvent } from '@deals/db';
import Link from 'next/link';
import { JsonForm } from '@/components/admin/json-form';
import { SubmitButton } from '@/components/admin/submit-button';
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
import { featureEventAction, saveEventAction } from '../actions';
import { listAdminEvents } from '../queries';

export const metadata = { title: '活动' };

const TEMPLATE = {
  slug: '',
  kind: 'seasonal',
  name: { zh: '', en: '' },
  tagline: { zh: '', en: '' },
  startsOn: null,
  endsOn: null,
  keyDates: [],
  featured: false,
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { edit } = await searchParams;
  const rows = await listAdminEvents();
  const editing = typeof edit === 'string' ? edit : null;
  const target = editing === 'new' ? null : rows.find((r) => String(r.id) === editing);
  const form =
    editing === 'new'
      ? { id: 'new', initial: TEMPLATE }
      : target
        ? (({ id, ...rest }) => ({ id: String(id), initial: rest }))(toEvent(target))
        : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">活动</h1>
        <Button size="sm" render={<Link href="/admin/events?edit=new" />}>
          新建活动
        </Button>
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>slug</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>主推</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.name.zh}</TableCell>
                <TableCell className="font-mono text-xs">{e.slug}</TableCell>
                <TableCell>{e.kind === 'evergreen' ? '常驻' : '季节性'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {e.startsOn || e.endsOn ? `${e.startsOn ?? '…'} → ${e.endsOn ?? '…'}` : '—'}
                </TableCell>
                <TableCell>{e.featured && <Badge>主推</Badge>}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    {!e.featured && (
                      <form action={featureEventAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <SubmitButton size="sm" variant="outline" pendingText="…">
                          设为主推
                        </SubmitButton>
                      </form>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/events?edit=${e.id}`} />}
                    >
                      编辑
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && !form && <p className="text-sm text-destructive">找不到该活动。</p>}
      {form && (
        <section className="max-w-4xl space-y-3 rounded-xl border p-4">
          <h2 className="font-medium">
            {form.id === 'new' ? '新建活动' : `编辑活动：${target?.name.zh}`}
          </h2>
          <p className="text-xs text-muted-foreground">
            按 eventSchema 校验。将 featured 设为 true 会同时取消其他活动的主推。
          </p>
          <JsonForm
            key={form.id}
            action={saveEventAction}
            id={form.id}
            initial={JSON.stringify(form.initial, null, 2)}
            submitLabel="保存"
          />
        </section>
      )}
    </div>
  );
}
