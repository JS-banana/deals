'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function VoteButtons({
  dealId,
  initial,
  compact = false,
}: {
  dealId: number;
  initial: { total: number; valid: number };
  compact?: boolean;
}) {
  const t = useTranslations('community');
  const [summary, setSummary] = useState(initial);
  const [state, setState] = useState<
    'idle' | 'sending' | 'voted' | 'duplicate' | 'failed' | 'unavailable'
  >('idle');
  async function vote(valid: boolean) {
    setState('sending');
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealId, valid }),
      });
      if (res.ok || res.status === 429) {
        setSummary(await res.json());
        setState(res.ok ? 'voted' : 'duplicate');
      } else setState(res.status === 503 ? 'unavailable' : 'failed');
    } catch {
      setState('failed');
    }
  }
  const disabled = state === 'sending' || state === 'voted' || state === 'duplicate';
  const voteTitle = t('voteTitle');
  const summaryText = summary.total
    ? t('voteSummary', {
        count: summary.total,
        percent: Math.round((100 * summary.valid) / summary.total),
      })
    : compact
      ? voteTitle
      : t('noVotes');
  const buttonSize = compact ? 'sm' : 'default';
  const buttonClass = compact ? 'text-xs' : undefined;
  return (
    <section
      className={
        compact
          ? 'flex flex-wrap items-center gap-2 text-xs text-muted-foreground'
          : 'space-y-2 rounded-xl border bg-card p-4'
      }
      aria-label={voteTitle}
    >
      {!compact && <h2 className="text-base font-semibold">{voteTitle}</h2>}
      <p className={compact ? undefined : 'text-sm text-muted-foreground'}>{summaryText}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size={buttonSize}
          className={buttonClass}
          disabled={disabled}
          onClick={() => vote(true)}
        >
          {t('valid')}
        </Button>
        <Button
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size={buttonSize}
          className={buttonClass}
          disabled={disabled}
          onClick={() => vote(false)}
        >
          {t('expired')}
        </Button>
      </div>
      <p role="status" className={compact ? 'empty:sr-only' : 'text-sm'}>
        {state !== 'idle' && state !== 'sending' && t(state)}
      </p>
    </section>
  );
}
