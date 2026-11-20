import type {
  Billing,
  CategorySlug,
  Deal,
  EventKind,
  KeyDate,
  Localized,
  Product,
  PublishStatus,
} from '@deals/core';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Evergreen product identity. Deals come and go; the product page accumulates them. */
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').$type<CategorySlug>().notNull(),
  website: text('website'),
  summary: jsonb('summary').$type<Localized>().notNull(),
  logoPath: text('logo_path'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A shopping season (BFCM, 618, …) or the evergreen bucket for always-on offers. */
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').$type<EventKind>().notNull().default('seasonal'),
  name: jsonb('name').$type<Localized>().notNull(),
  tagline: jsonb('tagline').$type<Localized>().notNull(),
  startsOn: day('starts_on'),
  endsOn: day('ends_on'),
  keyDates: jsonb('key_dates').$type<KeyDate[]>().notNull().default([]),
  featured: boolean('featured').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One product's offer within one event. Field semantics are defined by `dealSchema` in core. */
export const deals = pgTable(
  'deals',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    status: text('status').$type<PublishStatus>().notNull().default('draft'),
    rank: integer('rank').notNull().default(1000),
    plan: jsonb('plan').$type<Localized>().notNull(),
    priceAmount: money('price_amount'),
    originalAmount: money('original_amount'),
    currency: text('currency'),
    billing: text('billing').$type<Billing>().notNull().default('other'),
    discountPercent: integer('discount_percent'),
    discountAmount: money('discount_amount'),
    code: text('code'),
    noCode: boolean('no_code').notNull().default(false),
    startsOn: day('starts_on'),
    endsOn: day('ends_on'),
    startsAt: instant('starts_at'),
    endsAt: instant('ends_at'),
    dateZone: text('date_zone'),
    observedLiveOn: day('observed_live_on'),
    oneTime: boolean('one_time').notNull().default(false),
    existingUsers: boolean('existing_users').notNull().default(false),
    terms: jsonb('terms').$type<Localized>().notNull(),
    renewal: jsonb('renewal').$type<Localized>(),
    eligibility: jsonb('eligibility').$type<Localized>(),
    cardNote: jsonb('card_note').$type<Localized>(),
    merchantUrl: text('merchant_url').notNull(),
    sourceUrl: text('source_url'),
    verified: boolean('verified').notNull().default(false),
    checkedOn: day('checked_on').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('deals_product_event').on(t.productId, t.eventId),
    index('deals_status').on(t.status),
  ],
);

/** Raw page captures used for change detection and as evidence for AI extraction. */
export const pageSnapshots = pgTable(
  'page_snapshots',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    httpStatus: integer('http_status'),
    contentHash: text('content_hash'),
    title: text('title'),
    text: text('text'),
    error: text('error'),
  },
  (t) => [index('page_snapshots_url_time').on(t.url, t.fetchedAt.desc())],
);

/** Price history: one row per pipeline check of a published deal. */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: serial('id').primaryKey(),
    dealId: integer('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    priceAmount: money('price_amount'),
    currency: text('currency'),
    codePresent: boolean('code_present'),
    snapshotId: integer('snapshot_id').references(() => pageSnapshots.id, { onDelete: 'set null' }),
  },
  (t) => [index('price_observations_deal_time').on(t.dealId, t.observedAt.desc())],
);

export type ProposalKind = 'create' | 'update' | 'flag';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';
export interface ProposalPayload {
  product: Product;
  event: string;
  deal: Deal;
}
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface Evidence {
  field: string;
  quote: string;
  url: string;
}

/**
 * Review queue. The worker never edits published data directly: it files a proposal with the
 * full proposed record, the field-level diff and the quoted evidence. Approval applies it.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').$type<ProposalKind>().notNull(),
    status: text('status').$type<ProposalStatus>().notNull().default('pending'),
    dealId: integer('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<ProposalPayload>(),
    changes: jsonb('changes').$type<FieldChange[]>().notNull().default([]),
    evidence: jsonb('evidence').$type<Evidence[]>().notNull().default([]),
    reason: text('reason').notNull(),
    confidence: real('confidence'),
    /** Stable key so re-running a job does not file the same proposal twice. */
    dedupeKey: text('dedupe_key').notNull(),
    sourceRef: text('source_ref'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    unique('proposals_dedupe').on(t.dedupeKey),
    index('proposals_status').on(t.status, t.createdAt.desc()),
  ],
);

export const pipelineRuns = pgTable('pipeline_runs', {
  id: serial('id').primaryKey(),
  job: text('job').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ok: boolean('ok'),
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
});

/** Small cursors such as the last processed upstream commit. */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});
