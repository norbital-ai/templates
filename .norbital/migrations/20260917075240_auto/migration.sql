ALTER TABLE "companies" ADD COLUMN "facts" jsonb DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "facts" jsonb DEFAULT '[]' NOT NULL;
