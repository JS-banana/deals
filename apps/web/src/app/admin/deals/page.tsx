import { dealState, PUBLISH_STATUS } from '@deals/core';
import { toDeal } from '@deals/db';
import Link from 'next/link';
import { FilterLinks } from '@/components/admin/filter-links';
import {
  BILLING_LABEL,
  fmtMoney,
  fmtTime,
  STATE_LABEL,
  STATUS_LABEL,
} from '@/components/admin/format';
import { SubmitButton } from '@/components/admin/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setDealRankAction, setDealStatusAction } from '../actions';
import { listAdminDeals } from '../queries';

export const metadata = { title: '优惠' };

const STATUS_VARIANT = { published: 'default', draft: 'secondary', hidden: 'outline' } as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { status: rawStatus, event: rawEvent } = await searchParams;
  const status = PUBLISH_STATUS.find((s) => s === rawStatus);
  const all = await listAdminDeals();
  const events = [...new Map(all.map((r) => [r.event.slug, r.event])).values()];
  const eventSlug = events.find((e) => e.slug === rawEvent)?.slug;
  const rows = all.filter(
    (r) => (!status || r.deal.status === status) && (!eventSlug || r.event.slug === eventSlug),
  );
  const href = (s?: string, e?: string) => {
    const q = new URLSearchParams();
    if (s) q.set('status', s);
    if (e) q.set('event', e);
    return q.size ? `/admin/deals?${q}` : '/admin/deals';
  };
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterLinks
          items={[
            {
              label: '全部状态',
              href: href(undefined, eventSlug),
              active: !status,
              count: all.length,
            },
            ...PUBLISH_STATUS.map((s) => ({
              label: STATUS_LABEL[s] ?? s,
              href: href(s, eventSlug),
              active: s === status,
              count: all.filter((r) => r.deal.status === s).length,
            })),
          ]}
        />
        <FilterLinks
          items={[
            { label: '全部活动', href: href(status), active: !eventSlug },
            ...events.map((e) => ({
              label: e.name.zh,
              href: href(status, e.slug),
              active: e.slug === eventSlug,
            })),
          ]}
        />
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>产品</TableHead>
              <TableHead>活动</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间状态</TableHead>
              <TableHead>价格</TableHead>
              <TableHead>核对日期</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead>排序</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ deal, product, event }) => (
              <TableRow key={deal.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/deals/${deal.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {product.name}
                  </Link>
                </TableCell>
                <TableCell>{event.name.zh}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[deal.status]}>{STATUS_LABEL[deal.status]}</Badge>
                </TableCell>
                <TableCell>{STATE_LABEL[dealState(toDeal(deal), now)]}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmtMoney(deal.priceAmount, deal.currency)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {BILLING_LABEL[deal.billing]}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{deal.checkedOn}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtTime(deal.updatedAt)}</TableCell>
                <TableCell>
                  <form action={setDealRankAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={deal.id} />
                    <Input
                      name="rank"
                      type="number"
                      min={0}
                      defaultValue={deal.rank}
                      aria-label={`${product.name} 排序`}
                      className="h-7 w-20"
                    />
                    <SubmitButton size="sm" variant="outline" pendingText="…">
                      保存
                    </SubmitButton>
                  </form>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    <form action={setDealStatusAction}>
                      <input type="hidden" name="id" value={deal.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={deal.status === 'published' ? 'hidden' : 'published'}
                      />
                      <SubmitButton
                        size="sm"
                        variant={deal.status === 'published' ? 'destructive' : 'default'}
                        pendingText="…"
                      >
                        {deal.status === 'published' ? '隐藏' : '发布'}
                      </SubmitButton>
                    </form>
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/deals/${deal.id}`} />}
                    >
                      编辑
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">没有符合条件的优惠。</p>
        )}
      </div>
    </div>
  );
}
