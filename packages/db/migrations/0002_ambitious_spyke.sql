ALTER TABLE "deals" ADD COLUMN "observed_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "approved_payload" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "snapshot_id" integer;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "audit_inputs" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "shadow_decision" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "review_edited" boolean;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_snapshot" ON "proposals" USING btree ("snapshot_id");