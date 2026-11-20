import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { Providers } from '@/components/providers';
import '../globals.css';
import { pendingCount } from './queries';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: '审核后台', template: '%s · 审核后台' },
  robots: { index: false, follow: false },
};

// Every admin page reads live data.
export const dynamic = 'force-dynamic';

const links = [
  { href: '/admin', label: '待审核' },
  { href: '/admin/deals', label: '优惠' },
  { href: '/admin/events', label: '活动' },
  { href: '/admin/runs', label: '运行记录' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pending = await pendingCount();
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <header className="border-b bg-card">
            <div className="mx-auto flex h-12 max-w-7xl items-center gap-1 px-4">
              <span className="mr-3 text-sm font-semibold">好价清单 · 后台</span>
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {l.label}
                  {l.href === '/admin' && pending > 0 && (
                    <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
                      {pending}
                    </span>
                  )}
                </Link>
              ))}
              <Link
                href="/"
                className="ml-auto text-sm text-muted-foreground hover:text-foreground"
              >
                返回站点 ↗
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
