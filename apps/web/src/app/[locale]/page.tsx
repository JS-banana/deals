import { formatMoney, pick } from '@deals/core';
import { getLocale } from 'next-intl/server';
import { getPublishedDeals } from '@/lib/data';

// Placeholder that proves the data path end to end; replaced by the real discovery page.
export default async function Home() {
  const [deals, locale] = await Promise.all([getPublishedDeals(), getLocale()]);
  const lang = locale === 'en' ? 'en' : 'zh';
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold">{deals.length} deals</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {deals.map((d) => (
          <li key={d.id} className="rounded-xl border bg-card p-4">
            <p className="font-medium">{d.product.name}</p>
            <p className="text-sm text-muted-foreground">{pick(d.product.summary, lang)}</p>
            {d.priceAmount !== null && d.currency && (
              <p className="mt-2 text-2xl font-semibold">
                {formatMoney(d.priceAmount, d.currency, lang)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
