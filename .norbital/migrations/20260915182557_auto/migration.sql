ALTER TABLE "payment_catalogue" ADD COLUMN "source" text DEFAULT 'ENTRY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "schedule" jsonb;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "schedule_key" text;
--> statement-breakpoint
CREATE INDEX "payment_requests_schedule_key_idx" ON "payment_requests" ("schedule_key");
