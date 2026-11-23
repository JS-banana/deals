'use client';

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';

interface Result {
  href: string;
  label: string;
  detail?: string;
  kind: 'category' | 'topic' | 'offer';
}

export function CommandSearch() {
  const t = useTranslations('command');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResults([]);
    setStatus('loading');
    const timer = setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({ locale, q: query });
          const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
          if (!res.ok) throw new Error();
          const next = await res.json();
          if (!controller.signal.aborted) {
            setResults(next);
            setStatus('ready');
          }
        } catch {
          if (!controller.signal.aborted) setStatus('failed');
        }
      },
      query ? 100 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, locale]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }}
    >
      <DialogTrigger
        aria-label={t('title')}
        className="inline-flex h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden lg:inline">{t('title')}</span>
        <kbd className="hidden text-xs lg:inline">⌘K</kbd>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" initialFocus={input}>
        <DialogTitle>{t('title')}</DialogTitle>
        <Input
          ref={input}
          type="search"
          value={query}
          maxLength={120}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = list.current?.querySelector('a');
            if (event.key === 'ArrowDown' && first) {
              event.preventDefault();
              first.focus();
            }
            if (event.key === 'Enter') first?.click();
          }}
        />
        <ul ref={list} aria-label={t('results')} className="max-h-[45dvh] space-y-1 overflow-auto">
          {results.map((r, index) => (
            <li key={r.href}>
              <Link
                href={r.href}
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                }}
                onKeyDown={(event) => {
                  const links = list.current?.querySelectorAll('a');
                  if (!links?.length || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  if (event.key === 'ArrowUp' && index === 0) input.current?.focus();
                  else links[(index + (event.key === 'ArrowUp' ? -1 : 1)) % links.length]?.focus();
                }}
                className="flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-accent focus-visible:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{r.label}</span>
                  {r.detail && (
                    <span className="block text-xs text-muted-foreground">{r.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t(r.kind)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {!results.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(status === 'ready' ? 'empty' : status)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
