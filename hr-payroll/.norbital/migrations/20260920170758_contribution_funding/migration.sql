ALTER TABLE "payslips" ADD COLUMN "unfunded_contributions" numeric DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "funding_received" numeric DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "funding_received_on" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "funding_reference" text;
