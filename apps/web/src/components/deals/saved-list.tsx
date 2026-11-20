'use client';

import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import { clearSaved, useSaved } from '@/hooks/use-saved';
import { Link } from '@/i18n/navigation';

/**
 * The server renders a card for every published deal; the browser decides which ones to show
 * because favorites only exist in localStorage.
 */
export function SavedList({ items }: { items: { slug: string; card: ReactNode }[] }) {
  const t = useTranslations('saved');
  const hydrated = useHydrated();
  const saved = useSaved();
  const [confirming, setConfirming] = useState(false);

  if (!hydrated) {
    return (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton className="h-72 rounded-2xl" />
          </li>
        ))}
      </ul>
    );
  }

  const bySlug = new Map(items.map((item) => [item.slug, item.card]));
  const list = [...saved].reverse().flatMap((slug) => {
    const card = bySlug.get(slug);
    return card ? [{ slug, card }] : [];
  });

  if (list.length === 0) {
    return (
      <Empty className="rounded-2xl border bg-card py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bookmark aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-base">{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyText')}</EmptyDescription>
        </EmptyHeader>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          {t('browse')}
        </Link>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground tabular-nums">
          {t('count', { count: list.length })}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3 text-sm text-muted-foreground"
          onClick={() => {
            if (confirming) {
              clearSaved();
              setConfirming(false);
            } else setConfirming(true);
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? t('clearConfirm') : t('clear')}
        </Button>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map(({ slug, card }) => (
          <li key={slug} className="min-w-0">
            {card}
          </li>
        ))}
      </ul>
    </div>
  );
}
