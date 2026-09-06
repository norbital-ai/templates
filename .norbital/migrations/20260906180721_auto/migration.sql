ALTER TABLE "jurisdictions" ADD COLUMN "statutory_coverage" jsonb;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "settlement" jsonb NOT NULL;
