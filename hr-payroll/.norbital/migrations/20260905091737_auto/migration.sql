ALTER TABLE "leave_accounts" ADD COLUMN "statutory_cohort_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "allocation_units" numeric;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "weekly_index" numeric;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "event_unit" text DEFAULT 'DAYS' NOT NULL;
