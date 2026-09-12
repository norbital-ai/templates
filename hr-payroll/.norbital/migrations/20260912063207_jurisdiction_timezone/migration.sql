ALTER TABLE "jurisdiction_settings" DROP COLUMN "utc_offset_minutes";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL;
