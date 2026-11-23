import { CATEGORIES } from '@deals/core';
import type { ProposalPayload } from '@deals/db';
import { BILLING_LABEL, fmtMoney, Value } from './format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 border-b py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const range = (a: string | null, b: string | null) => (a || b ? `${a ?? '…'} → ${b ?? '…'}` : null);

/** Human-readable preview of a proposed product + deal (instead of raw JSON). */
export function PayloadPreview({ payload }: { payload: ProposalPayload }) {
  const { product, deal, event } = payload;
  const category = CATEGORIES.find((c) => c.slug === product.category);
  const price = [
    deal.priceAmount !== null ? fmtMoney(deal.priceAmount, deal.currency) : null,
    deal.originalAmount !== null ? `原价 ${fmtMoney(deal.originalAmount, deal.currency)}` : null,
    BILLING_LABEL[deal.billing] ?? deal.billing,
  ]
    .filter(Boolean)
    .join(' · ');
  const discount = [
    deal.discountPercent !== null ? `${deal.discountPercent}%` : null,
    deal.discountAmount !== null ? `减 ${fmtMoney(deal.discountAmount, deal.currency)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const flags = [
    deal.oneTime && '仅限一次',
    deal.existingUsers && '老用户可用',
    deal.verified && '已核实',
  ].filter(Boolean);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border p-4">
        <h3 className="mb-1 font-medium">产品</h3>
        <dl>
          <Row label="名称">
            <span className="font-medium">{product.name}</span>{' '}
            <span className="font-mono text-xs text-muted-foreground">{product.slug}</span>
          </Row>
          <Row label="分类">
            {category ? `${category.name.zh}（${product.category}）` : product.category}
          </Row>
          <Row label="官网">
            <Value value={product.website} />
          </Row>
          <Row label="简介">
            <Value value={product.summary} />
          </Row>
          <Row label="Logo">
            <Value value={product.logoPath} />
          </Row>
        </dl>
      </section>
      <section className="rounded-xl border p-4">
        <h3 className="mb-1 font-medium">优惠</h3>
        <dl>
          <Row label="活动">
            <span className="font-mono text-xs">{event}</span>
          </Row>
          <Row label="方案">
            <Value value={deal.plan} />
          </Row>
          <Row label="优惠标识">
            <code>{deal.offerKey ?? 'default'}</code>
          </Row>
          <Row label="优惠类型">
            {
              {
                discount: '折扣',
                free_credit: '免费额度',
                free_trial: '免费试用',
                lifetime: '买断',
                bundle: '组合优惠',
              }[deal.offerType ?? 'discount']
            }
          </Row>
          {deal.benefitSummary && (
            <Row label="优惠内容">
              <Value value={deal.benefitSummary} />
            </Row>
          )}
          {deal.estimatedValue != null && (
            <Row label="预估价值">{fmtMoney(deal.estimatedValue, deal.currency)}</Row>
          )}
          {deal.howToClaim && (
            <Row label="领取方式">
              <Value value={deal.howToClaim} />
            </Row>
          )}
          <Row label="价格">{price || '—'}</Row>
          <Row label="折扣">{discount || '—'}</Row>
          <Row label="优惠码">
            {deal.code ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{deal.code}</code>
            ) : deal.noCode ? (
              '无需优惠码'
            ) : (
              '—'
            )}
          </Row>
          <Row label="日期">
            <div>{range(deal.startsOn, deal.endsOn) ?? '—'}</div>
            {(deal.startsAt || deal.endsAt) && (
              <div className="text-xs text-muted-foreground">
                精确时刻 {range(deal.startsAt, deal.endsAt)}
              </div>
            )}
            {deal.dateZone && (
              <div className="text-xs text-muted-foreground">时区 {deal.dateZone}</div>
            )}
            {deal.observedLiveOn && (
              <div className="text-xs text-muted-foreground">
                实际观测上线 {deal.observedLiveOn}
              </div>
            )}
          </Row>
          <Row label="条款">
            <Value value={deal.terms} />
          </Row>
          <Row label="续费">
            <Value value={deal.renewal} />
          </Row>
          <Row label="适用对象">
            <Value value={deal.eligibility} />
          </Row>
          <Row label="信用卡说明">
            <Value value={deal.cardNote} />
          </Row>
          <Row label="标记">{flags.length ? flags.join('、') : '—'}</Row>
          <Row label="商家链接">
            <Value value={deal.merchantUrl} />
          </Row>
          <Row label="来源链接">
            <Value value={deal.sourceUrl} />
          </Row>
          <Row label="核对日期">{deal.checkedOn}</Row>
        </dl>
      </section>
    </div>
  );
}
