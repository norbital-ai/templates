ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_catalogue_id_payment_catalogue_fk";
--> statement-breakpoint
DROP TABLE "payment_catalogue";
--> statement-breakpoint
DROP TABLE "payment_requests";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "source" text DEFAULT 'ENTRY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "schedule" jsonb;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD COLUMN "reason" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD COLUMN "pay_period" text;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD COLUMN "schedule_key" text;
--> statement-breakpoint
CREATE INDEX "allowance_requests_schedule_key_idx" ON "allowance_requests" ("schedule_key");
