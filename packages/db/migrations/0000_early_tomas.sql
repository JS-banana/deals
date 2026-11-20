CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rank" integer DEFAULT 1000 NOT NULL,
	"plan" jsonb NOT NULL,
	"price_amount" numeric(12, 2),
	"original_amount" numeric(12, 2),
	"currency" text,
	"billing" text DEFAULT 'other' NOT NULL,
	"discount_percent" integer,
	"discount_amount" numeric(12, 2),
	"code" text,
	"no_code" boolean DEFAULT false NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"date_zone" text,
	"observed_live_on" date,
	"one_time" boolean DEFAULT false NOT NULL,
	"existing_users" boolean DEFAULT false NOT NULL,
	"terms" jsonb NOT NULL,
	"renewal" jsonb,
	"eligibility" jsonb,
	"card_note" jsonb,
	"merchant_url" text NOT NULL,
	"source_url" text,
	"verified" boolean DEFAULT false NOT NULL,
	"checked_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_product_event" UNIQUE("product_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'seasonal' NOT NULL,
	"name" jsonb NOT NULL,
	"tagline" jsonb NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"key_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"title" text,
	"text" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_amount" numeric(12, 2),
	"currency" text,
	"code_present" boolean,
	"snapshot_id" integer
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"website" text,
	"summary" jsonb NOT NULL,
	"logo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deal_id" integer,
	"payload" jsonb,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"confidence" real,
	"dedupe_key" text NOT NULL,
	"source_ref" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "proposals_dedupe" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_status" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "page_snapshots_url_time" ON "page_snapshots" USING btree ("url","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observations_deal_time" ON "price_observations" USING btree ("deal_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "proposals_status" ON "proposals" USING btree ("status","created_at" DESC NULLS LAST);