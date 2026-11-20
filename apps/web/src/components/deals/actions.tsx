'use client';

import { Popover } from '@base-ui/react/popover';
import { Bookmark, Check, Copy, Info, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { COMPARE_MAX, toggleCompare, useCompare } from '@/hooks/use-compare';
import { toggleSaved, useSaved } from '@/hooks/use-saved';
import type { CompareRow } from '@/lib/deal-view';
import { cn } from '@/lib/utils';

/** The coupon row: the whole row is one 40px+ button that copies the code. */
export function CopyCode({ code, className }: { code: string; className?: string }) {
  const t = useTranslations('deal.code');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t('copied', { code }));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t('copy', { code })}
      className={cn(
        'group/code relative z-10 flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-dashed border-input bg-muted/50 px-3 text-left transition-colors outline-none hover:border-ring hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <code className="truncate font-mono text-sm font-semibold">{code}</code>
      <span
        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover/code:text-foreground"
        aria-hidden="true"
      >
        {copied ? (
          <Check className="size-3.5 text-live-foreground" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? t('copiedShort') : t('copyShort')}
      </span>
    </button>
  );
}

/** Card-sized coupon: a dashed chip that copies the code on click. */
export function CodeChip({ code }: { code: string }) {
  const t = useTranslations('deal.code');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t('copied', { code }));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t('copy', { code })}
      title={t('copy', { code })}
      className="relative z-10 inline-flex h-8 max-w-[72%] min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-input bg-muted/50 px-2 transition-colors outline-none hover:border-ring hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <code className="truncate font-mono text-xs font-semibold">{code}</code>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-live-foreground" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

/** Bookmark toggle backed by localStorage; `aria-pressed` carries the state. */
export function SaveButton({
  slug,
  name,
  variant = 'icon',
  className,
}: {
  slug: string;
  name: string;
  variant?: 'icon' | 'full';
  className?: string;
}) {
  const t = useTranslations('actions');
  const saved = useSaved().includes(slug);
  const icon = <Bookmark className={cn('size-5', saved && 'fill-current')} aria-hidden="true" />;
  if (variant === 'full') {
    return (
      <Button
        type="button"
        variant="outline"
        aria-pressed={saved}
        onClick={() => toggleSaved(slug)}
        className={cn('h-11 gap-2 px-4 text-sm', saved && 'border-primary/40', className)}
      >
        {icon}
        {saved ? t('saved') : t('save')}
        <span className="sr-only">{name}</span>
      </Button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={t('saveLabel', { name })}
      title={saved ? t('unsave') : t('save')}
      onClick={() => toggleSaved(slug)}
      className={cn(
        'relative z-10 inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:text-foreground',
        className,
      )}
    >
      {icon}
    </button>
  );
}

/** Adds the deal to the comparison tray (max three): a labelled checkbox, or an icon toggle on cards. */
export function CompareToggle({
  row,
  variant = 'label',
}: {
  row: CompareRow;
  variant?: 'label' | 'icon';
}) {
  const t = useTranslations('actions');
  const rows = useCompare();
  const checked = rows.some((r) => r.slug === row.slug);
  const full = !checked && rows.length >= COMPARE_MAX;
  const id = useId();
  if (variant === 'icon') {
    return (
      <button
        type="button"
        aria-pressed={checked}
        aria-label={t('compareLabel', { name: row.name })}
        title={full ? t('compareFull', { max: COMPARE_MAX }) : t('compare')}
        disabled={full}
        onClick={() => toggleCompare(row)}
        className="relative z-10 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
      >
        <Scale className="size-4.5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <label
      htmlFor={id}
      title={full ? t('compareFull', { max: COMPARE_MAX }) : undefined}
      className="relative z-10 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50 has-disabled:hover:bg-transparent"
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={full}
        onCheckedChange={() => toggleCompare(row)}
        aria-label={t('compareLabel', { name: row.name })}
      />
      {t('compare')}
    </label>
  );
}

/** The card's "i" next to the plan: opens the deal note on hover, or on tap where there is no hover. */
export function NoteHint({ note }: { note: string }) {
  const t = useTranslations('deal');
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        aria-label={t('note')}
        className="relative z-10 -my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:text-foreground"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="z-50">
          <Popover.Popup className="max-w-64 origin-(--transform-origin) rounded-lg bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {note}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
