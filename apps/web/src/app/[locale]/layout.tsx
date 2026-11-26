import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { connection } from 'next/server';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { CompareBar } from '@/components/deals/compare';
import { Providers } from '@/components/providers';
import { GoogleAnalytics } from '@/components/site/google-analytics';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { routing } from '@/i18n/routing';
import { siteUrl } from '@/lib/data';
import { keywordList } from '@/lib/seo';
import '../globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t('title'), template: `%s · ${t('siteName')}` },
    description: t('description'),
    keywords: keywordList(t('keywords')),
    applicationName: t('siteName'),
    openGraph: {
      type: 'website',
      siteName: t('siteName'),
      locale: (await getLocale()) === 'zh' ? 'zh_CN' : 'en_US',
      images: [{ url: '/share.png', width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function LocaleLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const locale = await getLocale();
  await connection();
  const measurementId = process.env.GA_MEASUREMENT_ID?.trim();
  return (
    <html
      lang={locale === 'zh' ? 'zh-CN' : 'en'}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Providers>
            <SiteHeader />
            <main id="content" className="flex-1">
              {children}
            </main>
            {modal}
            <SiteFooter />
            <CompareBar />
          </Providers>
        </NextIntlClientProvider>
        {measurementId && /^G-[A-Z0-9]+$/.test(measurementId) && (
          <GoogleAnalytics measurementId={measurementId} />
        )}
      </body>
    </html>
  );
}
