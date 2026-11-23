import { cn } from 'cn';

const time = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Accepts strings too: raw SQL rows carry timestamps as ISO strings (drizzle disables driver date parsing). */
export const fmtTime = (d: Date | string | null | undefined) =>
  d ? time.format(new Date(d)) : '—';

export function fmtDuration(from: Date, to: Date | null) {
  if (!to) return '—';
  const s = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function fmtMoney(amount: number | null, currency: string | null) {
  if (amount === null) return '—';
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export const BILLING_LABEL: Record<string, string> = {
  one_time: '一次性买断',
  first_year: '首年',
  year: '每年',
  month: '每月',
  other: '其他',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  hidden: '已隐藏',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export const KIND_BADGE = {
  create: { label: '新增', variant: 'default' },
  update: { label: '更新', variant: 'secondary' },
  flag: { label: '异常', variant: 'destructive' },
} as const;

export const STATE_LABEL: Record<string, string> = {
  upcoming: '未开始',
  live: '进行中',
  ended: '已结束',
  unknown: '未确认开始',
};

const isLocalized = (v: unknown): v is { zh: string; en: string } =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 2 &&
  'zh' in v &&
  'en' in v;

/** Render any JSON value readably; Localized `{zh, en}` shows both languages. */
export function Value({ value, className }: { value: unknown; className?: string }) {
  if (value === null || value === undefined || value === '')
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  if (isLocalized(value))
    return (
      <div className={cn('space-y-0.5', className)}>
        <div>
          <span className="mr-1.5 text-xs text-muted-foreground">中</span>
          {value.zh || '—'}
        </div>
        <div>
          <span className="mr-1.5 text-xs text-muted-foreground">EN</span>
          {value.en || '—'}
        </div>
      </div>
    );
  if (typeof value === 'boolean') return <span className={className}>{value ? '是' : '否'}</span>;
  if (typeof value === 'string' && /^https?:\/\//.test(value))
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className={cn('break-all underline underline-offset-2', className)}
      >
        {value}
      </a>
    );
  if (typeof value === 'object')
    return (
      <pre className={cn('font-mono text-xs break-words whitespace-pre-wrap', className)}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  return <span className={cn('break-words', className)}>{String(value)}</span>;
}

export const SHADOW_LABEL = {
  auto_approve: 'AI 拟通过',
  auto_reject: 'AI 拟拒绝',
  manual_review: 'AI 建议人审',
} as const;
