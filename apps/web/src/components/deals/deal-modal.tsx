'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useHydrated } from '@/hooks/use-hydrated';
import { useMediaQuery } from '@/hooks/use-media-query';

/**
 * Shows an intercepted `/p/<slug>` route over the listing: a dialog on desktop, a bottom drawer on
 * mobile. Closing goes back in history, which also removes the intercepted route.
 */
export function DealModal({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const desktop = useMediaQuery('(min-width: 768px)');
  const hydrated = useHydrated();
  const [open, setOpen] = useState(true);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    setOpen(false);
    router.back();
  };

  if (!hydrated) return null;
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          aria-labelledby="product-title"
          className="max-h-[calc(100dvh-3rem)] gap-0 overflow-y-auto p-5 sm:max-w-[38rem] sm:p-6"
        >
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 z-10 size-10"
                aria-label={t('close')}
              />
            }
          >
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent aria-labelledby="product-title">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-8">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
