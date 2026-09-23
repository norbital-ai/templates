DROP INDEX "adhoc_catalogue_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "allowance_catalogue_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "claim_catalogue_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "companies_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "employees_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "employment_statutory_facts_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "employment_terms_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "employment_wage_periods_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "employments_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "jurisdiction_holidays_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "jurisdiction_settings_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "leave_catalogue_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "leave_entries_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "loan_catalogue_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "loans_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "payment_holds_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "payroll_runs_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "payslips_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "shift_definitions_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "shift_patterns_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "statutory_contributions_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "adhoc_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "adhoc_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce((CASE status ->> 'kind'
				WHEN 'REGISTERED' THEN 'Registered · ' || COALESCE(NULLIF(status ->> 'reference_number', ''), 'no reference')
				WHEN 'NOT_REGISTERED' THEN 'Not registered · ' || COALESCE(NULLIF(status ->> 'reason', ''), 'no reason given')
				ELSE 'Statutory fact'
			END || ' · from ' || LEFT(effective_range ->> 'start', 10)), ''))) STORED;
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce((COALESCE(job_title || ' · ', '') || employment_type), ''))) STORED;
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reference", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("employee_number", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("summary", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "loans" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reference", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "payment_holds" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("directive_reference", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("period", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("currency", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "shift_patterns" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "adhoc_catalogue_search_document_gin_idx" ON "adhoc_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_document_gin_idx" ON "allowance_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_document_gin_idx" ON "claim_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "companies_search_document_gin_idx" ON "companies" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employees_search_document_gin_idx" ON "employees" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_statutory_facts_search_document_gin_idx" ON "employment_statutory_facts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_terms_search_document_gin_idx" ON "employment_terms" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_wage_periods_search_document_gin_idx" ON "employment_wage_periods" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employments_search_document_gin_idx" ON "employments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdiction_holidays_search_document_gin_idx" ON "jurisdiction_holidays" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_search_document_gin_idx" ON "jurisdiction_settings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_catalogue_search_document_gin_idx" ON "leave_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_entries_search_document_gin_idx" ON "leave_entries" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_document_gin_idx" ON "loan_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loans_search_document_gin_idx" ON "loans" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payment_holds_search_document_gin_idx" ON "payment_holds" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_document_gin_idx" ON "payroll_runs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslips_search_document_gin_idx" ON "payslips" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_document_gin_idx" ON "shift_definitions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_document_gin_idx" ON "shift_patterns" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_search_document_gin_idx" ON "statutory_contributions" USING gin ("search_document");
