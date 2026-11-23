import type {
  Billing,
  CategorySlug,
  Deal,
  EventKind,
  KeyDate,
  Localized,
  OfferType,
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
    offerKey: text('offer_key').notNull().default('default'),
    offerType: text('offer_type').$type<OfferType>().notNull().default('discount'),
    benefitSummary: jsonb('benefit_summary').$type<Localized>(),
    estimatedValue: money('estimated_value'),
    howToClaim: jsonb('how_to_claim').$type<Localized>(),
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
    observedEndedAt: instant('observed_ended_at'),
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
    unique('deals_product_event_offer').on(t.productId, t.eventId, t.offerKey),
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

/** Inputs that cannot be recovered from the immutable payload, evidence and snapshot alone. */
export interface AuditInputs {
  merchantUrl: string;
  upstreamText: string;
  dropped: number;
  notes: string[];
}

export interface ShadowDecision {
  action: 'auto_approve' | 'auto_reject' | 'manual_review';
  score: number | null;
  summary: string;
  issues: string[];
}

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
    approvedPayload: jsonb('approved_payload').$type<ProposalPayload>(),
    snapshotId: integer('snapshot_id').references(() => pageSnapshots.id, { onDelete: 'restrict' }),
    auditInputs: jsonb('audit_inputs').$type<AuditInputs>(),
    shadowDecision: jsonb('shadow_decision').$type<ShadowDecision>(),
    reviewedBy: text('reviewed_by').$type<'human' | 'ai'>(),
    reviewEdited: boolean('review_edited'),
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
    index('proposals_snapshot').on(t.snapshotId),
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

export interface RawSignal {
  signalKey: string;
  sourceType: 'github' | 'rss' | 'reddit' | 'hn' | 'x' | 'search' | 'user_tip';
  sourceName: string;
  sourceUrl: string;
  title: string;
  rawText: string;
  candidateUrls: string[];
  publishedAt: string | null;
  engagement?: number;
}

export const rawSignals = pgTable(
  'raw_signals',
  {
    id: serial('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    signalKey: text('signal_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    signal: jsonb('signal').$type<RawSignal>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    processedAt: instant('processed_at'),
    createdAt: createdAt(),
    submitterHash: text('submitter_hash'),
  },
  (t) => [
    unique('raw_signal_version').on(t.sourceId, t.signalKey, t.fingerprint),
    index('raw_signal_queue').on(t.sourceId, t.processedAt, t.id),
    index('raw_signal_submitter').on(t.submitterHash, t.createdAt),
  ],
);

export const dealVotes = pgTable(
  'deal_votes',
  {
    id: serial('id').primaryKey(),
    dealId: integer('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    voterHash: text('voter_hash').notNull(),
    valid: boolean('valid').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('deal_votes_recent').on(t.dealId, t.createdAt),
    index('deal_votes_identity').on(t.dealId, t.voterHash, t.createdAt),
  ],
);

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: serial('id').primaryKey(),
  kind: text('kind').$type<'slack' | 'discord' | 'feishu' | 'wecom' | 'dingtalk'>().notNull(),
  // A named deployment secret holds the URL. Never store bearer URLs in the catalog.
  secretName: text('secret_name').notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
});

/** Small cursors such as the last processed upstream commit. */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/**
 * Translation memory, zh -> en. One row per distinct source text (hash of the normalized zh), so
 * a repeated text is translated once. A field's English is fresh while it equals the row for its
 * current zh; the worker's translate job is the only writer.
 */
export const translations = pgTable(
  'translations',
  {
    id: serial('id').primaryKey(),
    sourceLang: text('source_lang').notNull().default('zh'),
    targetLang: text('target_lang').notNull().default('en'),
    sourceHash: text('source_hash').notNull(),
    sourceText: text('source_text').notNull(),
    targetText: text('target_text').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    glossaryVersion: text('glossary_version').notNull(),
    /** Reviewer score 0-100 at the time it was published. */
    score: integer('score').notNull(),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    unique('translations_source').on(t.sourceLang, t.targetLang, t.sourceHash),
    index('translations_target').on(t.targetLang, t.targetText),
  ],
);
