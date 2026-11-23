'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function TipForm() {
  const t = useTranslations('community');
  const [state, setState] = useState<
    'idle' | 'sending' | 'submitted' | 'failed' | 'unavailable' | 'limited' | 'invalid'
  >('idle');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    setState('sending');
    try {
      const res = await fetch('/api/tips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: fd.get('url'), note: fd.get('note') }),
      });
      if (res.ok) {
        form.reset();
        setState('submitted');
      } else
        setState(
          res.status === 429
            ? 'limited'
            : res.status === 503
              ? 'unavailable'
              : res.status === 400
                ? 'invalid'
                : 'failed',
        );
    } catch {
      setState('failed');
    }
  }
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) setState('idle');
      }}
    >
      <DialogTrigger className="cursor-pointer hover:text-foreground">
        {t('tipTitle')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('tipTitle')}</DialogTitle>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5" htmlFor="tip-url">
            {t('tipUrl')}
            <Input
              id="tip-url"
              name="url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://"
            />
          </label>
          <label className="grid gap-1.5" htmlFor="tip-note">
            {t('tipNote')}
            <Textarea id="tip-note" name="note" required maxLength={500} />
          </label>
          <Button type="submit" disabled={state === 'sending'}>
            {t('send')}
          </Button>
          <p role="status">{state !== 'idle' && state !== 'sending' && t(state)}</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
