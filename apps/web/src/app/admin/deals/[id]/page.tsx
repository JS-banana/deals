import { toDeal, toProduct } from '@deals/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonForm } from '@/components/admin/json-form';
import { saveDealAction } from '../../actions';
import { getDealWithRefs } from '../../queries';

export const metadata = { title: '编辑优惠' };

export default async function DealEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const found = await getDealWithRefs(id);
  if (!found) notFound();
  const { id: _id, ...product } = toProduct(found.product);
  const initial = JSON.stringify({ product, deal: toDeal(found.deal) }, null, 2);

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/admin/deals" className="text-sm text-muted-foreground hover:text-foreground">
        ← 返回优惠列表
      </Link>
      <h1 className="text-xl font-semibold">
        {found.product.name} · {found.event.name.zh}
      </h1>
      <p className="text-sm text-muted-foreground">
        编辑 {'{product, deal}'}，保存时按 productSchema / dealSchema
        校验并在一个事务内写入。发布状态与排序请在列表页调整；省略 logoPath 时保留原值。
      </p>
      <JsonForm action={saveDealAction} id={id} initial={initial} submitLabel="保存" />
    </div>
  );
}
