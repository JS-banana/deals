import { cn } from 'cn';
import Link from 'next/link';

export interface FilterItem {
  label: string;
  href: string;
  active: boolean;
  count?: number;
}

export function FilterLinks({ items }: { items: FilterItem[] }) {
  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm transition-colors',
            item.active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="ml-1.5 tabular-nums opacity-70">{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
