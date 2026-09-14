DROP TABLE "work_catalogue";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "research_notes";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "work_rules" jsonb NOT NULL;
