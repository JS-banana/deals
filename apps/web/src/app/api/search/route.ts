import { CATEGORIES, pick, TOPICS } from '@deals/core';
import { getPublishedDeals } from '@/lib/data';
import { dealHref, toLocale } from '@/lib/deal-view';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = toLocale(params.get('locale') ?? '');
  const q = (params.get('q') ?? '').trim().toLowerCase().slice(0, 120);
  const matches = (value: string) => value.toLowerCase().includes(q);
  const categories = CATEGORIES.filter((c) =>
    matches([c.slug, c.name.en, c.name.zh].join(' ')),
  ).map((c) => ({
    href: `/category/${c.slug}`,
    label: pick(c.name, locale),
    kind: 'category',
  }));
  const topics = TOPICS.filter((t) => matches([t.slug, t.title.en, t.title.zh].join(' '))).map(
    (t) => ({
      href: `/topics/${t.slug}`,
      label: pick(t.title, locale),
      kind: 'topic',
    }),
  );
  const offers = q
    ? (await getPublishedDeals())
        .filter((d) =>
          matches([d.product.name, d.product.slug, d.code, d.plan.en, d.plan.zh].join(' ')),
        )
        .slice(0, 15)
        .map((d) => ({
          href: dealHref(d.product.slug, d.id),
          label: d.product.name,
          detail: [pick(d.plan, locale), d.code].filter(Boolean).join(' · '),
          kind: 'offer',
        }))
    : [];
  return Response.json([...categories, ...topics, ...offers]);
}
