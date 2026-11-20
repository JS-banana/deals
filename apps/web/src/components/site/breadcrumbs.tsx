import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { toLocale } from '@/lib/deal-view';
import { JsonLd, pageUrl } from '@/lib/seo';

export interface Crumb {
  label: string;
  /** Unprefixed path. The last crumb is the current page and renders as plain text. */
  href: string;
}

/** Visible breadcrumb trail plus the matching `BreadcrumbList` JSON-LD. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useTranslations('common');
  const locale = toLocale(useLocale());
  return (
    <>
      <nav aria-label={t('breadcrumb')}>
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <li key={item.label} className="inline-flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3.5" aria-hidden="true" />}
              {index < items.length - 1 ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-8 items-center rounded-sm transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.label,
            item: pageUrl(item.href, locale),
          })),
        }}
      />
    </>
  );
}
