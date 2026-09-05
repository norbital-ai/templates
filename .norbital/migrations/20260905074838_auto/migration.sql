ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_allocation_id_leave_allocations_fk";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_statutory_profile_id_jurisdictions_fk";
--> statement-breakpoint
DROP TABLE "leave_allocations";
--> statement-breakpoint
DROP INDEX "leave_types_statutory_profile_id_idx";
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "allocation_id";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "statutory_profile_id";
--> statement-breakpoint
CREATE TABLE "leave_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("leave_code", '') || ' ' || coalesce("leave_name", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_code" text NOT NULL,
	"leave_name" text NOT NULL,
	"opening_plan_id" uuid NOT NULL,
	"opening_statutory_profile_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"starts_on" timestamp with time zone NOT NULL,
	"ends_on" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"entitlement_days" numeric NOT NULL,
	"accrual_kind" text NOT NULL,
	"carry_limit_days" numeric,
	"carry_expiry_months" integer,
	"calculation" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"leave_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"effective_on" timestamp with time zone NOT NULL,
	"days" numeric NOT NULL,
	"expires_on" timestamp with time zone,
	"reason" text NOT NULL,
	"source_key" text NOT NULL,
	"source_request_id" uuid,
	"leave_plan_id" uuid,
	"statutory_profile_id" uuid
);

--> statement-breakpoint
CREATE TABLE "leave_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"transition" text DEFAULT 'NEXT_LEAVE_YEAR' NOT NULL,
	"effective_range" jsonb NOT NULL,
	"supersedes_id" uuid,
	"change_note" text NOT NULL
);

--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "leave_account_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "leave_plan_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(('Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'), ''))) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "from_date";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "from_date" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(event #>> '{range,start,date}')) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "to_date";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "to_date" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(event #>> '{range,end,date}')) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "days";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "days" numeric GENERATED ALWAYS AS ((event ->> 'chargeable_days')::numeric) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "half_day_start";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day_start" boolean GENERATED ALWAYS AS ((event #>> '{range,start,half}') = 'SECOND') STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "half_day_end";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day_end" boolean GENERATED ALWAYS AS ((event #>> '{range,end,half}') = 'FIRST') STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "reason";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "reason" text GENERATED ALWAYS AS (event ->> 'reason') STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "summary";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "summary" text GENERATED ALWAYS AS ('Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd') STORED;
--> statement-breakpoint
DROP INDEX "leave_types_company_id_code_index";
--> statement-breakpoint
CREATE INDEX "leave_types_company_id_code_index" ON "leave_types" ("company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_accounts_employment_id_leave_code_leave_year_index" ON "leave_accounts" ("employment_id","leave_code","leave_year");
--> statement-breakpoint
CREATE INDEX "leave_accounts_starts_on_ends_on_index" ON "leave_accounts" ("starts_on","ends_on");
--> statement-breakpoint
CREATE INDEX "leave_accounts_search_document_gin_idx" ON "leave_accounts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_accounts_search_text_trgm_idx" ON "leave_accounts" USING gin ((coalesce("leave_code", '') || ' ' || coalesce("leave_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_entries_leave_account_id_effective_on_index" ON "leave_entries" ("leave_account_id","effective_on");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entries_leave_account_id_source_key_index" ON "leave_entries" ("leave_account_id","source_key");
--> statement-breakpoint
CREATE INDEX "leave_entries_source_request_id_idx" ON "leave_entries" ("source_request_id");
--> statement-breakpoint
CREATE INDEX "leave_plans_company_id_code_index" ON "leave_plans" ("company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_plans_supersedes_id_index" ON "leave_plans" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "leave_plans_search_document_gin_idx" ON "leave_plans" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_plans_search_text_trgm_idx" ON "leave_plans" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_leave_plan_id_code_index" ON "leave_types" ("leave_plan_id","code");
--> statement-breakpoint
CREATE INDEX "leave_requests_search_document_gin_idx" ON "leave_requests" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_requests_employment_id_leave_type_id_from_date_index" ON "leave_requests" ("employment_id","leave_type_id","from_date");
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD CONSTRAINT "leave_accounts_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD CONSTRAINT "leave_accounts_leave_type_id_leave_types_fk" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id");
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD CONSTRAINT "leave_accounts_opening_plan_id_leave_plans_fk" FOREIGN KEY ("opening_plan_id") REFERENCES "leave_plans"("id");
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD CONSTRAINT "leave_accounts_opening_statutory_profile_id_jurisdictions_fk" FOREIGN KEY ("opening_statutory_profile_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_account_id_leave_accounts_fk" FOREIGN KEY ("leave_account_id") REFERENCES "leave_accounts"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_plan_id_leave_plans_fk" FOREIGN KEY ("leave_plan_id") REFERENCES "leave_plans"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_statutory_profile_id_jurisdictions_fk" FOREIGN KEY ("statutory_profile_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "leave_plans" ADD CONSTRAINT "leave_plans_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "leave_plans" ADD CONSTRAINT "leave_plans_supersedes_id_leave_plans_fk" FOREIGN KEY ("supersedes_id") REFERENCES "leave_plans"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_account_id_leave_accounts_fk" FOREIGN KEY ("leave_account_id") REFERENCES "leave_accounts"("id");
--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_leave_plan_id_leave_plans_fk" FOREIGN KEY ("leave_plan_id") REFERENCES "leave_plans"("id") ON DELETE CASCADE;
