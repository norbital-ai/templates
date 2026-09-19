CREATE TABLE "adhoc_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"authority" text,
	"destination" text NOT NULL,
	"direction" text,
	"bands" jsonb DEFAULT '[]' NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT 'NONE' NOT NULL,
	"counts_toward" jsonb DEFAULT '[]' NOT NULL,
	"raised_by" text DEFAULT 'MANUAL' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adhoc_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"event_date" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"evidence_file" jsonb,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"pay_period" text,
	"payslip_id" uuid
);
--> statement-breakpoint
CREATE TABLE "allowance_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"authority" text,
	"destination" text NOT NULL,
	"direction" text,
	"bands" jsonb DEFAULT '[]' NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT 'NONE' NOT NULL,
	"fixed" boolean DEFAULT true NOT NULL,
	"counts_toward" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"derived_from_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"from" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL,
	"basis" jsonb NOT NULL,
	"days" numeric NOT NULL,
	"denominator" numeric NOT NULL,
	"unpaid_days" numeric NOT NULL,
	"contract_amount" numeric NOT NULL,
	"amount" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text DEFAULT '' NOT NULL,
	"evidence_file" jsonb,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"destination" text NOT NULL,
	"direction" text,
	"bands" jsonb DEFAULT '[]' NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT 'NONE' NOT NULL,
	"counts_toward" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"incurred_on" timestamp with time zone NOT NULL,
	"description" text,
	"evidence_file" jsonb,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"pay_period" text,
	"payslip_id" uuid
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"settings_code" text NOT NULL,
	"name" text NOT NULL,
	"registration_number" text,
	"pay_cutoff_day" integer NOT NULL,
	"pay_frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"semi_monthly_statutory_cutoff" text DEFAULT 'FIRST' NOT NULL,
	"risk_class" text,
	"region" text,
	"facts" jsonb DEFAULT '{}' NOT NULL,
	"holiday_source" jsonb,
	"workbook_layout" text DEFAULT 'MATRIX' NOT NULL,
	"disbursement_account" jsonb,
	"effective_range" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"name" text NOT NULL,
	"date_of_birth" timestamp with time zone,
	"gender" text,
	"marital_status" text,
	"solo_parent" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"receiving_pension" boolean DEFAULT false NOT NULL,
	"race" text,
	"religion" text,
	"spouse_status" text,
	"children" jsonb DEFAULT '[]' NOT NULL,
	"nationality" text,
	"identity_number" text,
	"dependents_count" integer DEFAULT 0 NOT NULL,
	"email" text,
	"phone" text,
	"address" jsonb,
	"user_id" uuid,
	"face_embedding" vector(1024),
	"face_photo" jsonb,
	"face_enrollment_status" text DEFAULT 'NONE' NOT NULL,
	"face_consent_at" timestamp with time zone,
	"face_enrolled_at" timestamp with time zone,
	"face_last_match_at" timestamp with time zone,
	"face_match_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_statutory_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((CASE status ->> 'kind'
				WHEN 'REGISTERED' THEN 'Registered · ' || COALESCE(NULLIF(status ->> 'reference_number', ''), 'no reference')
				WHEN 'NOT_REGISTERED' THEN 'Not registered · ' || COALESCE(NULLIF(status ->> 'reason', ''), 'no reason given')
				ELSE 'Statutory fact'
			END || ' · from ' || LEFT(effective_range ->> 'start', 10)), ''))) STORED,
	"employee_id" uuid NOT NULL,
	"statutory_contribution_id" uuid NOT NULL,
	"status" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL,
	"summary" text GENERATED ALWAYS AS (CASE status ->> 'kind'
				WHEN 'REGISTERED' THEN 'Registered · ' || COALESCE(NULLIF(status ->> 'reference_number', ''), 'no reference')
				WHEN 'NOT_REGISTERED' THEN 'Not registered · ' || COALESCE(NULLIF(status ->> 'reason', ''), 'no reason given')
				ELSE 'Statutory fact'
			END || ' · from ' || LEFT(effective_range ->> 'start', 10)) STORED
);
--> statement-breakpoint
CREATE TABLE "employment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((COALESCE(job_title || ' · ', '') || employment_type), ''))) STORED,
	"employment_id" uuid NOT NULL,
	"residency_status" text,
	"residency_since" timestamp with time zone,
	"pass_type" text,
	"tax_residency" text,
	"base_salary" jsonb NOT NULL,
	"pay_frequency" text NOT NULL,
	"work_classification" text NOT NULL,
	"statutory_work_category" text DEFAULT 'NON_MANUAL' NOT NULL,
	"employment_type" text NOT NULL,
	"notice_days" integer,
	"department" text,
	"job_title" text,
	"payroll_group" text,
	"grade" text,
	"ordinary_hours_per_week" integer,
	"shift_pattern_id" uuid NOT NULL,
	"effective_range" jsonb NOT NULL,
	"summary" text GENERATED ALWAYS AS (COALESCE(job_title || ' · ', '') || employment_type) STORED
);
--> statement-breakpoint
CREATE TABLE "employments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("employee_number", ''))) STORED,
	"employee_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"contract_number" integer DEFAULT 1 NOT NULL,
	"bank" jsonb,
	"effective_range" jsonb NOT NULL,
	"exit_reason" text,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"company_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'PUBLIC_HOLIDAY' NOT NULL,
	"replaces" timestamp with time zone,
	"given_to" text DEFAULT 'EVERYONE' NOT NULL,
	"source" text,
	"published_at" timestamp with time zone
);
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
	"jurisdiction_code" text NOT NULL,
	"name" text NOT NULL,
	"sealed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cloned_from_id" uuid,
	"payroll" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"work_rules" jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]' NOT NULL,
	"change_summary" text,
	"effective_range" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"authority" text,
	"eligibility" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT 'NONE' NOT NULL,
	"is_npl" boolean DEFAULT false NOT NULL,
	"pay_fraction" text DEFAULT '' NOT NULL,
	"paid_by" text DEFAULT 'EMPLOYER' NOT NULL,
	"consumes_code" text,
	"unit" text DEFAULT 'DAY' NOT NULL,
	"can_encash" boolean DEFAULT true NOT NULL,
	"encash_on_exit" boolean DEFAULT false NOT NULL,
	"evidence_after_days" integer,
	"entitlement" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("summary", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"leave_code" text NOT NULL,
	"reference" text NOT NULL,
	"certificate_file" jsonb,
	"charges" jsonb NOT NULL,
	"allocations" jsonb NOT NULL,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"from_date" timestamp with time zone,
	"to_date" timestamp with time zone,
	"half_day_start" boolean,
	"half_day_end" boolean,
	"days" numeric,
	"hours" numeric,
	"encash_days" numeric,
	"reversal_of_id" uuid,
	"effective_on" timestamp with time zone,
	"due_on" timestamp with time zone,
	"destination_from" timestamp with time zone,
	"destination_to" timestamp with time zone,
	"available_from" timestamp with time zone,
	"expires_on" timestamp with time zone,
	"reason" text,
	"event_kind" text,
	"event_relationship" text,
	"event_child_index" integer,
	"event_date" timestamp with time zone,
	"summary" text,
	"payslip_id" uuid
);
--> statement-breakpoint
CREATE TABLE "loan_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"destination" text DEFAULT 'NET' NOT NULL,
	"direction" text DEFAULT 'SUBTRACT',
	"bands" jsonb DEFAULT '[]' NOT NULL,
	"loan_type" text DEFAULT 'STAFF' NOT NULL,
	"minimum_repayment" numeric,
	"eligibility" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT 'NONE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"loan_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"amount_due" numeric NOT NULL,
	"sequence" integer NOT NULL,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"payslip_id" uuid
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("reference", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"loan_catalogue_id" uuid NOT NULL,
	"principal" numeric NOT NULL,
	"effective_range" jsonb NOT NULL,
	"effective_from" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(effective_range ->> 'start')) STORED,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("period", ''))) STORED,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"holidays" jsonb NOT NULL,
	"settings_id" uuid NOT NULL,
	"calculation_version" text NOT NULL,
	"pay_date" timestamp with time zone NOT NULL,
	"attendance_from" timestamp with time zone NOT NULL,
	"attendance_to" timestamp with time zone NOT NULL,
	"calculation_trace" jsonb DEFAULT '[]' NOT NULL,
	"company_charges" jsonb DEFAULT '[]' NOT NULL,
	"warnings" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("currency", ''))) STORED,
	"payroll_run_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"terms_through" timestamp with time zone NOT NULL,
	"base" jsonb NOT NULL,
	"proration" jsonb NOT NULL,
	"statutory" jsonb NOT NULL,
	"adjustments" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"paid_at" timestamp with time zone,
	"gross" numeric NOT NULL,
	"total_deductions" numeric NOT NULL,
	"net" numeric NOT NULL,
	"employer_cost" numeric NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"period" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_definitions" (
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
	"variant" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_patterns" (
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
	"pattern" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"authority" text,
	"assessment_period" text DEFAULT 'PAY_PERIOD' NOT NULL,
	"assessment_scope" text DEFAULT 'EMPLOYMENT' NOT NULL,
	"elections" jsonb DEFAULT '[]' NOT NULL,
	"employee_share_annual_cap" integer,
	"shared_cap_group" text,
	"project_relief_annually" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]' NOT NULL,
	"assessed_on" text DEFAULT '' NOT NULL,
	"parts" jsonb DEFAULT '[]' NOT NULL,
	"ordinary_on" text DEFAULT '' NOT NULL,
	"short_name" text,
	"listing_order" integer,
	"listing_group" text
);
--> statement-breakpoint
CREATE TABLE "work_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"work_date" timestamp with time zone NOT NULL,
	"shift_definition_id" uuid,
	"worked_intervals" jsonb,
	"requested_by" text,
	"payslip_id" uuid
);
--> statement-breakpoint
CREATE INDEX "adhoc_catalogue_search_document_gin_idx" ON "adhoc_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "adhoc_catalogue_search_text_trgm_idx" ON "adhoc_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "adhoc_catalogue_settings_id_code_index" ON "adhoc_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "adhoc_requests_catalogue_id_idx" ON "adhoc_requests" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "adhoc_requests_employment_id_event_date_index" ON "adhoc_requests" ("employment_id","event_date");
--> statement-breakpoint
CREATE INDEX "adhoc_requests_employment_id_pay_period_index" ON "adhoc_requests" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "adhoc_requests_payslip_id_idx" ON "adhoc_requests" ("payslip_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "allowance_catalogue_settings_id_code_index" ON "allowance_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_document_gin_idx" ON "allowance_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_text_trgm_idx" ON "allowance_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "allowance_entries_derived_from_id_idx" ON "allowance_entries" ("derived_from_id");
--> statement-breakpoint
CREATE INDEX "allowance_entries_employment_id_idx" ON "allowance_entries" ("employment_id");
--> statement-breakpoint
CREATE INDEX "allowance_entries_from_idx" ON "allowance_entries" ("from");
--> statement-breakpoint
CREATE INDEX "allowance_entries_payslip_id_idx" ON "allowance_entries" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "allowances_catalogue_id_idx" ON "allowances" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "allowances_effective_from_idx" ON "allowances" ("effective_from");
--> statement-breakpoint
CREATE INDEX "allowances_employment_id_idx" ON "allowances" ("employment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_catalogue_settings_id_code_index" ON "claim_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_document_gin_idx" ON "claim_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_text_trgm_idx" ON "claim_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "claim_requests_employment_id_pay_period_index" ON "claim_requests" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "claim_requests_employment_id_incurred_on_index" ON "claim_requests" ("employment_id","incurred_on");
--> statement-breakpoint
CREATE INDEX "claim_requests_catalogue_id_idx" ON "claim_requests" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "claim_requests_payslip_id_idx" ON "claim_requests" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "companies_settings_code_idx" ON "companies" ("settings_code");
--> statement-breakpoint
CREATE INDEX "companies_search_document_gin_idx" ON "companies" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "companies_search_text_trgm_idx" ON "companies" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employees_face_embedding_hnsw" ON "employees" USING hnsw ("face_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employees_search_document_gin_idx" ON "employees" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employees_search_text_trgm_idx" ON "employees" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employment_statutory_facts_search_document_gin_idx" ON "employment_statutory_facts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_statutory_facts_search_text_trgm_idx" ON "employment_statutory_facts" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employment_terms_search_document_gin_idx" ON "employment_terms" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_terms_search_text_trgm_idx" ON "employment_terms" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employments_search_document_gin_idx" ON "employments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employments_search_text_trgm_idx" ON "employments" USING gin ((coalesce("employee_number", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_holidays_company_id_date_index" ON "jurisdiction_holidays" ("company_id","date");
--> statement-breakpoint
CREATE INDEX "jurisdiction_holidays_published_at_idx" ON "jurisdiction_holidays" ("published_at");
--> statement-breakpoint
CREATE INDEX "jurisdiction_holidays_search_document_gin_idx" ON "jurisdiction_holidays" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdiction_holidays_search_text_trgm_idx" ON "jurisdiction_holidays" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_code_sealed_at_index" ON "jurisdiction_settings" ("code","sealed_at");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_code_idx" ON "jurisdiction_settings" ("code");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_search_document_gin_idx" ON "jurisdiction_settings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_search_text_trgm_idx" ON "jurisdiction_settings" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_catalogue_settings_id_code_index" ON "leave_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "leave_catalogue_search_document_gin_idx" ON "leave_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_catalogue_search_text_trgm_idx" ON "leave_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_entries_employment_id_leave_code_effective_on_index" ON "leave_entries" ("employment_id","leave_code","effective_on");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entries_employment_id_reference_index" ON "leave_entries" ("employment_id","reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entries_reversal_of_id_index" ON "leave_entries" ("reversal_of_id");
--> statement-breakpoint
CREATE INDEX "leave_entries_payslip_id_idx" ON "leave_entries" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "leave_entries_search_document_gin_idx" ON "leave_entries" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_entries_search_text_trgm_idx" ON "leave_entries" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_catalogue_settings_id_code_index" ON "loan_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_document_gin_idx" ON "loan_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_text_trgm_idx" ON "loan_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_repayments_loan_id_sequence_index" ON "loan_repayments" ("loan_id","sequence");
--> statement-breakpoint
CREATE INDEX "loan_repayments_employment_id_idx" ON "loan_repayments" ("employment_id");
--> statement-breakpoint
CREATE INDEX "loan_repayments_payslip_id_idx" ON "loan_repayments" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "loans_employment_id_idx" ON "loans" ("employment_id");
--> statement-breakpoint
CREATE INDEX "loans_loan_catalogue_id_idx" ON "loans" ("loan_catalogue_id");
--> statement-breakpoint
CREATE INDEX "loans_search_document_gin_idx" ON "loans" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loans_search_text_trgm_idx" ON "loans" USING gin ((coalesce("reference", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_id_period_index" ON "payroll_runs" ("company_id","period");
--> statement-breakpoint
CREATE INDEX "payroll_runs_settings_id_idx" ON "payroll_runs" ("settings_id");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_document_gin_idx" ON "payroll_runs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_text_trgm_idx" ON "payroll_runs" USING gin ((coalesce("period", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_payroll_run_id_employment_id_index" ON "payslips" ("payroll_run_id","employment_id");
--> statement-breakpoint
CREATE INDEX "payslips_search_document_gin_idx" ON "payslips" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslips_search_text_trgm_idx" ON "payslips" USING gin ((coalesce("currency", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_employment_id_period_index" ON "rosters" ("employment_id","period");
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definitions_company_id_code_index" ON "shift_definitions" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_document_gin_idx" ON "shift_definitions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_text_trgm_idx" ON "shift_definitions" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_patterns_company_id_code_index" ON "shift_patterns" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_document_gin_idx" ON "shift_patterns" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_text_trgm_idx" ON "shift_patterns" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_contributions_settings_id_code_index" ON "statutory_contributions" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_search_document_gin_idx" ON "statutory_contributions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_search_text_trgm_idx" ON "statutory_contributions" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "work_days_employment_id_work_date_index" ON "work_days" ("employment_id","work_date");
--> statement-breakpoint
CREATE INDEX "work_days_work_date_idx" ON "work_days" ("work_date");
--> statement-breakpoint
ALTER TABLE "adhoc_catalogue" ADD CONSTRAINT "adhoc_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "adhoc_requests" ADD CONSTRAINT "adhoc_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "adhoc_requests" ADD CONSTRAINT "adhoc_requests_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "adhoc_requests" ADD CONSTRAINT "adhoc_requests_catalogue_id_adhoc_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "adhoc_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD CONSTRAINT "allowance_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_derived_from_id_allowances_fk" FOREIGN KEY ("derived_from_id") REFERENCES "allowances"("id");
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "allowance_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "allowance_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD CONSTRAINT "claim_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_catalogue_id_claim_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "claim_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_employee_id_employees_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("id");
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_shift_pattern_id_shift_patterns_fk" FOREIGN KEY ("shift_pattern_id") REFERENCES "shift_patterns"("id");
--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_employee_id_employees_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");
--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD CONSTRAINT "jurisdiction_holidays_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD CONSTRAINT "leave_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_catalogue_id_leave_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "leave_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_reversal_of_id_leave_entries_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "leave_entries"("id");
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD CONSTRAINT "loan_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_loans_fk" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_loan_catalogue_id_loan_catalogue_fk" FOREIGN KEY ("loan_catalogue_id") REFERENCES "loan_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id");
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_shift_definition_id_shift_definitions_fk" FOREIGN KEY ("shift_definition_id") REFERENCES "shift_definitions"("id");
