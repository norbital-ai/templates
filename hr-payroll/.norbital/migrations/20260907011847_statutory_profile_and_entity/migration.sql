ALTER TABLE "jurisdictions" DROP CONSTRAINT "jurisdictions_supersedes_id_jurisdictions_fk";
--> statement-breakpoint
DROP TABLE "statutory_research_sources";
--> statement-breakpoint
DROP INDEX "jurisdictions_supersedes_id_index";
--> statement-breakpoint
DROP INDEX "jurisdictions_lifecycle_idx";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "pay_day";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "pay_calendar";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "leave_year_start_month";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "absence_component_id";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "overtime_calculation_method";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "settlement_policy";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "lifecycle";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "ordinary_rate_basis";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "ordinary_rate_divisor";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "supersedes_id";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "successor_profile_id";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "void_reason";
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pay_frequency" text DEFAULT 'MONTHLY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "ordinary_rate" jsonb NOT NULL;
--> statement-breakpoint
CREATE INDEX "jurisdictions_sealed_idx" ON "jurisdictions" ("sealed");
