CREATE TABLE "translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_lang" text DEFAULT 'zh' NOT NULL,
	"target_lang" text DEFAULT 'en' NOT NULL,
	"source_hash" text NOT NULL,
	"source_text" text NOT NULL,
	"target_text" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"glossary_version" text NOT NULL,
	"score" integer NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translations_source" UNIQUE("source_lang","target_lang","source_hash")
);
--> statement-breakpoint
CREATE INDEX "translations_target" ON "translations" USING btree ("target_lang","target_text");