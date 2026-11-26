'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef } from 'react';

type GoogleTag = (...args: unknown[]) => void;

const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_id',
  'utm_term',
  'utm_content',
  'gclid',
];

export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const previousPage = useRef<string>(null);

  useEffect(() => {
    if (!pathname) return;
    const location = new URL(window.location.href);
    const page = new URL(location.origin);
    page.pathname = pathname;
    if (previousPage.current === page.href) return;

    const referrer = document.referrer ? new URL(document.referrer) : null;
    let pageReferrer = previousPage.current ?? referrer?.origin ?? '';
    if (!previousPage.current && referrer?.origin === page.origin) {
      pageReferrer = `${referrer.origin}${referrer.pathname}`;
    }
    previousPage.current = page.href;

    // Keep campaign attribution without sending search text, filters or pagination.
    for (const name of CAMPAIGN_PARAMS) {
      const value = location.searchParams.get(name);
      if (value) page.searchParams.set(name, value);
    }
    const tagWindow = window as Window & { dataLayer?: IArguments[]; gtag?: GoogleTag };
    const params = { page_location: page.href, page_referrer: pageReferrer };
    tagWindow.dataLayer ??= [];
    const { dataLayer } = tagWindow;
    if (!tagWindow.gtag) {
      tagWindow.gtag = function gtag(..._args: unknown[]) {
        // Google's tag queue expects the arguments object.
        // biome-ignore lint/complexity/noArguments: Google tag queue format
        dataLayer.push(arguments);
      };
      tagWindow.gtag('js', new Date());
      tagWindow.gtag('set', params);
      tagWindow.gtag('config', measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
    } else {
      tagWindow.gtag('set', params);
    }
    tagWindow.gtag('event', 'page_view', params);
  }, [measurementId, pathname]);

  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      strategy="afterInteractive"
      referrerPolicy="origin"
    />
  );
}
