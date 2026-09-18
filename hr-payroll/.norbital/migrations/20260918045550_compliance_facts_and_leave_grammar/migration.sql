ALTER TABLE "allowance_catalogue" ADD COLUMN "on_separation" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "authority" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "pass_type" text;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "tax_residency" text;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "notice_days" integer;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "pay_fraction" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "paid_by" text DEFAULT 'EMPLOYER' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "consumes_code" text;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "unit" text DEFAULT 'DAY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "hours" numeric;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "event_kind" text;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "event_relationship" text;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "event_child_index" integer;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "event_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "work_days" ADD COLUMN "requested_by" text;
