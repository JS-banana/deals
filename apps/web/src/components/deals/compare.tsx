'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { clearCompare, removeCompare, useCompare } from '@/hooks/use-compare';
import { Link } from '@/i18n/navigation';
import { type CompareRow, toLocale } from '@/lib/deal-view';
import { cn } from '@/lib/utils';
import { ProductLogo } from './parts';

const FIELDS = [
  'plan',
  'price',
  'original',
  'discount',
  'renewal',
  'eligibility',
  'code',
  'deadline',
  'terms',
] as const satisfies readonly (keyof CompareRow)[];

/** Sticky tray with the picked deals, plus the side-by-side comparison dialog. */
export function CompareBar() {
  const t = useTranslations('compare');
  const locale = toLocale(useLocale());
  // Rows were formatted for one language; ignore leftovers from the other site.
  const rows = useCompare().filter((row) => row.locale === locale);
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const ready = rows.length >= 2;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <section
          aria-label={t('label')}
          className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border bg-card/95 p-2 pl-3 shadow-xl backdrop-blur sm:gap-3"
        >
          <p className="hidden shrink-0 text-sm font-medium tabular-nums sm:block">
            {t('selected', { count: rows.length })}
          </p>
          <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {rows.map((row) => (
              <li key={row.slug} className="shrink-0">
                <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-muted pr-1 pl-2 text-sm">
                  <ProductLogo product={row} size="sm" />
                  <span className="max-w-24 truncate">{row.name}</span>
                  <button
                    type="button"
                    onClick={() => removeCompare(row.slug)}
                    aria-label={t('remove', { name: row.name })}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={!ready}
            onClick={() => setOpen(true)}
            title={ready ? undefined : t('needTwo')}
            className="h-10 shrink-0 px-4 text-sm"
          >
            {t('open')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={clearCompare}
            className="hidden h-10 shrink-0 px-3 text-sm text-muted-foreground sm:inline-flex"
          >
            {t('clear')}
          </Button>
        </section>
      </div>

      <Dialog open={open && ready} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        >
          <div className="flex items-start justify-between gap-4 p-4 pb-3 sm:p-6 sm:pb-4">
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold">{t('title')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-1 size-10 shrink-0"
                  aria-label={t('close')}
                />
              }
            >
              <X className="size-5" aria-hidden="true" />
            </DialogClose>
          </div>
          <div className="overflow-auto px-4 pb-4 sm:px-6 sm:pb-6">
            <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{t('title')}</caption>
              <thead>
                <tr>
                  <td className="sticky left-0 z-10 bg-popover" />
                  {rows.map((row) => (
                    <th key={row.slug} scope="col" className="min-w-52 p-3 text-left align-top">
                      <span className="flex items-center gap-2">
                        <ProductLogo product={row} size="sm" />
                        <Link
                          href={`/p/${row.slug}`}
                          onClick={() => setOpen(false)}
                          className="truncate font-semibold underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((field) => (
                  <tr key={field}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-28 min-w-24 border-t bg-popover py-3 pr-3 text-left align-top font-normal text-muted-foreground"
                    >
                      {t(`rows.${field}`)}
                    </th>
                    {rows.map((row) => (
                      <td
                        key={row.slug}
                        className={cn(
                          'border-t p-3 align-top',
                          field === 'price' && 'font-semibold tabular-nums',
                          field === 'code' && 'font-mono',
                        )}
                      >
                        {row[field]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
