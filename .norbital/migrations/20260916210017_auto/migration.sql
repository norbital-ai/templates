ALTER TABLE "statutory_contributions" DROP COLUMN "base";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "assessment_scope" text DEFAULT 'EMPLOYMENT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "elections" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "assessed_on" text DEFAULT '' NOT NULL;
