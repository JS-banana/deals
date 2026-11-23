'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function VoteButtons({
  dealId,
  initial,
}: {
  dealId: number;
  initial: { total: number; valid: number };
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
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label={t('voteTitle')}>
      <h2 className="text-base font-semibold">{t('voteTitle')}</h2>
      <p className="text-sm text-muted-foreground">
        {summary.total
          ? t('voteSummary', {
              count: summary.total,
              percent: Math.round((100 * summary.valid) / summary.total),
            })
          : t('noVotes')}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => vote(true)}>
          {t('valid')}
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => vote(false)}>
          {t('expired')}
        </Button>
      </div>
      <p role="status" className="text-sm">
        {state !== 'idle' && state !== 'sending' && t(state)}
      </p>
    </section>
  );
}
