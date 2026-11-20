import { type DealView, dealState, pick, TOPICS } from '@deals/core';
import { ArrowRight, Infinity as InfinityIcon, Palette, Terminal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { toLocale } from '@/lib/deal-view';

const TOPIC_ICONS = { developers: Terminal, lifetime: InfinityIcon, creators: Palette } as const;

/** Curated topic entry points with the number of deals that are still available. */
export function TopicsSection({ deals, now }: { deals: readonly DealView[]; now: Date }) {
  const t = useTranslations('topics');
  const locale = toLocale(useLocale());
  return (
    <section
      aria-labelledby="topics-title"
      className="mx-auto max-w-7xl px-4 pt-14 sm:px-6 lg:px-8"
    >
      <div className="mb-5 space-y-1">
        <h2 id="topics-title" className="text-2xl font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground">{t('text')}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {TOPICS.map((topic) => {
          const Icon = TOPIC_ICONS[topic.slug as keyof typeof TOPIC_ICONS] ?? Terminal;
          const count = deals.filter((d) => topic.match(d) && dealState(d, now) !== 'ended').length;
          return (
            <li key={topic.slug}>
              <Link
                href={`/topics/${topic.slug}`}
                className="group/topic flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 transition-[border-color,box-shadow] outline-none hover:border-foreground/20 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="space-y-1">
                  <span className="block text-lg font-semibold">{pick(topic.title, locale)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {pick(topic.text, locale)}
                  </span>
                </span>
                <span className="mt-auto flex items-center justify-between pt-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">
                    {t('count', { count })}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    {t('open')}
                    <ArrowRight
                      className="size-4 transition-transform group-hover/topic:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
