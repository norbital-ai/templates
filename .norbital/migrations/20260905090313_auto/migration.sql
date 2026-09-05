DROP INDEX "leave_accounts_employment_id_leave_code_leave_year_index";
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "account_kind" text DEFAULT 'YEAR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "event_reference" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "qualifying_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "eligibility_evidence" text;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "account_basis" text DEFAULT 'YEAR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "event_window_months" integer;
--> statement-breakpoint
ALTER TABLE "leave_accounts" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("event_reference", '') || ' ' || coalesce("leave_code", '') || ' ' || coalesce("leave_name", ''))) STORED;
--> statement-breakpoint
DROP INDEX "leave_accounts_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "leave_accounts_search_text_trgm_idx" ON "leave_accounts" USING gin ((coalesce("event_reference", '') || ' ' || coalesce("leave_code", '') || ' ' || coalesce("leave_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_accounts_employment_id_leave_code_leave_year_event_reference_index" ON "leave_accounts" ("employment_id","leave_code","leave_year","event_reference");
--> statement-breakpoint
CREATE INDEX "leave_accounts_search_document_gin_idx" ON "leave_accounts" USING gin ("search_document");
