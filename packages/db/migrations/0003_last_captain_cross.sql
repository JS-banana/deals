CREATE TABLE "deal_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"voter_hash" text NOT NULL,
	"valid" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"signal_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"signal" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitter_hash" text,
	CONSTRAINT "raw_signal_version" UNIQUE("source_id","signal_key","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"secret_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "webhook_subscriptions_secret_name_unique" UNIQUE("secret_name")
);
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_product_event";--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "offer_key" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "offer_type" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "benefit_summary" jsonb;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "estimated_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "how_to_claim" jsonb;--> statement-breakpoint
ALTER TABLE "deal_votes" ADD CONSTRAINT "deal_votes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_votes_recent" ON "deal_votes" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_votes_identity" ON "deal_votes" USING btree ("deal_id","voter_hash","created_at");--> statement-breakpoint
CREATE INDEX "raw_signal_queue" ON "raw_signals" USING btree ("source_id","processed_at","id");--> statement-breakpoint
CREATE INDEX "raw_signal_submitter" ON "raw_signals" USING btree ("submitter_hash","created_at");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_event_offer" UNIQUE("product_id","event_id","offer_key");