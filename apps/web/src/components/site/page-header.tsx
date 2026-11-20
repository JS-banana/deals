import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Title block for category and topic pages. */
export function PageHeader({
  title,
  text,
  icon: Icon,
  tint,
  meta,
}: {
  title: string;
  text?: string;
  icon?: LucideIcon;
  tint?: string;
  meta?: string;
}) {
  return (
    <header className="flex items-start gap-4">
      {Icon && (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-2xl',
            tint ?? 'bg-secondary text-secondary-foreground',
          )}
        >
          <Icon className="size-7" />
        </span>
      )}
      <div className="min-w-0 space-y-1">
        <h1 className="text-3xl font-semibold text-balance sm:text-4xl">{title}</h1>
        {text && <p className="max-w-2xl text-muted-foreground">{text}</p>}
        {meta && <p className="text-sm text-muted-foreground tabular-nums">{meta}</p>}
      </div>
    </header>
  );
}
