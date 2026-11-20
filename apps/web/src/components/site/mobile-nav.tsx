'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';
import { LocaleSwitch } from './locale-switch';
import { NAV_ITEMS } from './nav-items';
import { ThemeToggle } from './theme-toggle';

export function MobileNav() {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('menu')}>
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>{t('menu')}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t('label')} className="flex flex-col gap-1 px-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base hover:bg-accent"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-2 border-t px-4 pt-4">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </SheetContent>
    </Sheet>
  );
}
