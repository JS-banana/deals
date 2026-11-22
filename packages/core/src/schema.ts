import { z } from 'zod';

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Editorial text. `zh` is the source of truth; `en` may be empty until translated. */
export const localized = z.object({ zh: z.string().trim().min(1), en: z.string().trim() });
export type Localized = z.infer<typeof localized>;

export const CATEGORY_SLUGS = [
  'ai',
  'developer',
  'productivity',
  'design',
  'cloud',
  'utilities',
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** How the advertised price is billed. Drives the "/ year" style unit next to the price. */
export const BILLING = ['one_time', 'first_year', 'year', 'month', 'other'] as const;
export type Billing = (typeof BILLING)[number];

export const PUBLISH_STATUS = ['draft', 'published', 'hidden'] as const;
export type PublishStatus = (typeof PUBLISH_STATUS)[number];

export const EVENT_KINDS = ['seasonal', 'evergreen'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-kebab slug');
const isoDate = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const httpsUrl = z.url({ protocol: /^https$/ });
const timeZone = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA time zone');

export const productSchema = z.object({
  slug,
  name: z.string().trim().min(1),
  category: z.enum(CATEGORY_SLUGS),
  website: httpsUrl.nullable(),
  summary: localized,
  logoPath: z.string().nullable(),
});
export type Product = z.infer<typeof productSchema>;

export const keyDateSchema = z.object({ date: isoDate, label: localized });
export type KeyDate = z.infer<typeof keyDateSchema>;

export const eventSchema = z.object({
  slug,
  kind: z.enum(EVENT_KINDS),
  name: localized,
  tagline: localized,
  startsOn: isoDate.nullable(),
  endsOn: isoDate.nullable(),
  keyDates: z.array(keyDateSchema),
  featured: z.boolean(),
});
export type DealEvent = z.infer<typeof eventSchema>;

export const dealSchema = z
  .object({
    plan: localized,
    priceAmount: z.number().nonnegative().nullable(),
    originalAmount: z.number().positive().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    billing: z.enum(BILLING),
    discountPercent: z.number().int().min(1).max(100).nullable(),
    discountAmount: z.number().positive().nullable(),
    code: z.string().trim().min(1).nullable(),
    noCode: z.boolean(),
    startsOn: isoDate.nullable(),
    endsOn: isoDate.nullable(),
    startsAt: instant.nullable(),
    endsAt: instant.nullable(),
    dateZone: timeZone.nullable(),
    observedLiveOn: isoDate.nullable(),
    oneTime: z.boolean(),
    existingUsers: z.boolean(),
    terms: localized,
    renewal: localized.nullable(),
    eligibility: localized.nullable(),
    cardNote: localized.nullable(),
    merchantUrl: httpsUrl,
    sourceUrl: httpsUrl.nullable(),
    verified: z.boolean(),
    checkedOn: isoDate,
  })
  .superRefine((d, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if ((d.priceAmount !== null || d.originalAmount !== null) && !d.currency)
      issue('currency', 'currency is required when an amount is set');
    if (d.discountAmount !== null && !d.currency)
      issue('currency', 'currency is required for a discount amount');
    if (d.priceAmount === null && d.discountPercent === null && d.discountAmount === null)
      issue('priceAmount', 'a deal needs a price or a discount');
    if (d.code && d.noCode) issue('noCode', 'noCode conflicts with a coupon code');
    if (d.startsOn && d.endsOn && d.startsOn > d.endsOn) issue('endsOn', 'ends before it starts');
    if (d.startsAt && d.endsAt && Date.parse(d.startsAt) >= Date.parse(d.endsAt))
      issue('endsAt', 'ends before it starts');
    if (d.priceAmount !== null && d.originalAmount !== null && d.priceAmount >= d.originalAmount)
      issue('priceAmount', 'deal price is not below the original price');
  });
export type Deal = z.infer<typeof dealSchema>;

/** Read model shared by the web app and the worker: a deal joined with its product and event. */
export interface DealView extends Deal {
  id: number;
  rank: number;
  status: PublishStatus;
  product: Product & { id: number };
  event: Pick<DealEvent, 'slug' | 'kind' | 'name'> & { id: number };
}

export interface CategoryInfo {
  slug: CategorySlug;
  name: Localized;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { slug: 'ai', name: { zh: 'AI 工具', en: 'AI tools' } },
  { slug: 'developer', name: { zh: '开发工具', en: 'Developer tools' } },
  { slug: 'productivity', name: { zh: '效率软件', en: 'Productivity' } },
  { slug: 'design', name: { zh: '设计创作', en: 'Design & creative' } },
  { slug: 'cloud', name: { zh: '云服务', en: 'Cloud & storage' } },
  { slug: 'utilities', name: { zh: '实用工具', en: 'Utilities' } },
];

export const isCategory = (value: unknown): value is CategorySlug =>
  CATEGORY_SLUGS.includes(value as CategorySlug);

export interface TopicInfo {
  slug: string;
  title: Localized;
  text: Localized;
  match: (deal: DealView) => boolean;
}

export const TOPICS: readonly TopicInfo[] = [
  {
    slug: 'developers',
    title: { zh: '独立开发者工具优惠', en: 'Indie developer toolkit' },
    text: {
      zh: '开发、测试、部署的实用工具与服务。',
      en: 'Tools and services for building, testing and shipping.',
    },
    match: (d) => d.product.category === 'developer' || d.product.category === 'cloud',
  },
  {
    slug: 'lifetime',
    title: { zh: '买断制软件优惠', en: 'Fewer subscriptions' },
    text: {
      zh: '有买断选项的软件，集中比较授权条件。',
      en: 'Software you can buy once, with license terms side by side.',
    },
    match: (d) => d.oneTime,
  },
  {
    slug: 'creators',
    title: { zh: '设计与创作工具优惠', en: 'Picks for creators' },
    text: {
      zh: '写作、设计与内容创作的效率工具。',
      en: 'Tools for writing, design and content creation.',
    },
    match: (d) => d.product.category === 'ai' || d.product.category === 'design',
  },
];

export function pick(text: Localized | null | undefined, locale: Locale): string {
  if (!text) return '';
  return locale === 'en' && text.en ? text.en : text.zh;
}
