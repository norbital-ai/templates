ALTER TABLE "companies" DROP CONSTRAINT "companies_jurisdiction_id_jurisdictions_fk";
--> statement-breakpoint
ALTER TABLE "company_holidays" DROP CONSTRAINT "company_holidays_company_id_companies_fk";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_company_id_companies_fk";
--> statement-breakpoint
ALTER TABLE "pay_components" DROP CONSTRAINT "pay_components_company_id_companies_fk";
--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP CONSTRAINT "payroll_runs_statutory_snapshot_id_jurisdictions_fk";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP CONSTRAINT "statutory_contributions_jurisdiction_id_jurisdictions_fk";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP CONSTRAINT "statutory_contributions_statutory_profile_id_jurisdictions_fk";
--> statement-breakpoint
DROP TABLE "jurisdictions";
--> statement-breakpoint
DROP INDEX "leave_types_company_id_code_index";
--> statement-breakpoint
DROP INDEX "pay_components_company_id_code_index";
--> statement-breakpoint
DROP INDEX "payroll_runs_statutory_snapshot_id_idx";
--> statement-breakpoint
DROP INDEX "statutory_contributions_statutory_profile_id_code_index";
--> statement-breakpoint
DROP INDEX "statutory_contributions_jurisdiction_id_idx";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "jurisdiction_id";
--> statement-breakpoint
ALTER TABLE "company_holidays" DROP COLUMN "company_id";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "company_id";
--> statement-breakpoint
ALTER TABLE "pay_components" DROP COLUMN "company_id";
--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP COLUMN "statutory_snapshot_id";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "jurisdiction_id";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "statutory_profile_id";
--> statement-breakpoint
CREATE TABLE "jurisdiction_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sealed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cloned_from_id" uuid,
	"currency" text NOT NULL,
	"tax_year_start_month" integer NOT NULL,
	"proration" jsonb NOT NULL,
	"ordinary_rate" jsonb NOT NULL,
	"regime" jsonb NOT NULL,
	"research_urls" text[],
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "settings_code" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_holidays" ADD COLUMN "settings_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_holidays" ADD COLUMN "is_statutory" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "settings_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "pay_components" ADD COLUMN "settings_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "settings_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "settings_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "is_statutory" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE INDEX "companies_settings_code_idx" ON "companies" ("settings_code");
--> statement-breakpoint
CREATE INDEX "company_holidays_settings_id_date_index" ON "company_holidays" ("settings_id","date");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_code_sealed_at_index" ON "jurisdiction_settings" ("code","sealed_at");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_code_idx" ON "jurisdiction_settings" ("code");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_search_document_gin_idx" ON "jurisdiction_settings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_search_text_trgm_idx" ON "jurisdiction_settings" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_settings_id_code_index" ON "leave_types" ("settings_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "pay_components_settings_id_code_index" ON "pay_components" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "payroll_runs_settings_id_idx" ON "payroll_runs" ("settings_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_contributions_settings_id_code_index" ON "statutory_contributions" ("settings_id","code");
--> statement-breakpoint
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
