ALTER TABLE "leave_accounts" DROP CONSTRAINT "leave_accounts_opening_plan_id_leave_plans_fk";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP CONSTRAINT "leave_entries_leave_account_id_leave_accounts_fk";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP CONSTRAINT "leave_entries_leave_plan_id_leave_plans_fk";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP CONSTRAINT "leave_entries_statutory_profile_id_jurisdictions_fk";
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_leave_account_id_leave_accounts_fk";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_leave_plan_id_leave_plans_fk";
--> statement-breakpoint
DROP TABLE "leave_accounts";
--> statement-breakpoint
DROP TABLE "leave_plans";
--> statement-breakpoint
DROP INDEX "leave_entries_leave_account_id_effective_on_index";
--> statement-breakpoint
DROP INDEX "leave_entries_leave_account_id_source_key_index";
--> statement-breakpoint
DROP INDEX "leave_types_leave_plan_id_code_index";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "statutory_leave";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "statutory_coverage";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "leave_account_id";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "leave_plan_id";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "statutory_profile_id";
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "leave_account_id";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "leave_plan_id";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "statutory_kind";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "account_basis";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "event_unit";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "event_window_months";
--> statement-breakpoint
CREATE TABLE "leave_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("leave_code", '') || ' ' || coalesce("leave_name", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"starts_on" timestamp with time zone NOT NULL,
	"ends_on" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"entitlement_days" numeric NOT NULL,
	"accrual_kind" text NOT NULL,
	"settlement" jsonb NOT NULL,
	"exit_settlement" jsonb NOT NULL,
	"leave_code" text NOT NULL,
	"leave_name" text NOT NULL
);

--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "leave_entitlement_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "leave_entitlement_id" uuid;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "is_statutory" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "authority" text;
--> statement-breakpoint
ALTER TABLE "leave_types" ALTER COLUMN "eligibility" SET DATA TYPE text USING "eligibility"::text;
--> statement-breakpoint
ALTER TABLE "leave_types" ALTER COLUMN "eligibility" SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE "pay_components" ALTER COLUMN "eligibility" SET DATA TYPE text USING "eligibility"::text;
--> statement-breakpoint
ALTER TABLE "pay_components" ALTER COLUMN "eligibility" SET DEFAULT '';
--> statement-breakpoint
DROP INDEX "leave_types_company_id_code_index";
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_company_id_code_index" ON "leave_types" ("company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entitlements_employment_id_leave_type_id_leave_year_index" ON "leave_entitlements" ("employment_id","leave_type_id","leave_year");
--> statement-breakpoint
CREATE INDEX "leave_entitlements_starts_on_ends_on_index" ON "leave_entitlements" ("starts_on","ends_on");
--> statement-breakpoint
CREATE INDEX "leave_entitlements_search_document_gin_idx" ON "leave_entitlements" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_entitlements_search_text_trgm_idx" ON "leave_entitlements" USING gin ((coalesce("leave_code", '') || ' ' || coalesce("leave_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_entries_leave_entitlement_id_effective_on_index" ON "leave_entries" ("leave_entitlement_id","effective_on");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entries_leave_entitlement_id_source_key_index" ON "leave_entries" ("leave_entitlement_id","source_key");
--> statement-breakpoint
ALTER TABLE "leave_entitlements" ADD CONSTRAINT "leave_entitlements_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_entitlements" ADD CONSTRAINT "leave_entitlements_leave_type_id_leave_types_fk" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_entitlement_id_leave_entitlements_fk" FOREIGN KEY ("leave_entitlement_id") REFERENCES "leave_entitlements"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_entitlement_id_leave_entitlements_fk" FOREIGN KEY ("leave_entitlement_id") REFERENCES "leave_entitlements"("id");
