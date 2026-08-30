CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"jurisdiction_id" uuid NOT NULL,
	"name" text NOT NULL,
	"registration_number" text NOT NULL,
	"pay_cutoff_day" integer NOT NULL,
	"pay_day" integer NOT NULL,
	"pay_calendar" jsonb,
	"leave_year_start_month" integer NOT NULL,
	"overtime_calculation_method" text DEFAULT 'STATUTORY_AGGREGATE' NOT NULL,
	"settlement_policy" jsonb,
	"risk_class" text,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "company_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"company_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"substitutes_date" timestamp with time zone,
	"name" text NOT NULL,
	"scope" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "component_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"pay_component_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"quantity" numeric,
	"event_date" timestamp with time zone NOT NULL,
	"pay_period" text,
	"effective_range" jsonb,
	"event" jsonb NOT NULL,
	"corrects_adjustment_id" uuid,
	"evidence_file" jsonb
);

--> statement-breakpoint
CREATE TABLE "contribution_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((CASE selector ->> 'by'
				WHEN 'WAGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'WAGE_AND_AGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · age ' || (selector ->> 'age_from') || '–' || COALESCE(selector ->> 'age_to', '∞')
				WHEN 'WAGE_AND_MARITAL' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · ' || LOWER(selector ->> 'marital')
				WHEN 'HEADCOUNT' THEN 'headcount ' || (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'RISK_CLASS' THEN 'risk ' || (selector ->> 'class')
				ELSE 'band'
			END), ''))) STORED,
	"statutory_contribution_id" uuid NOT NULL,
	"selector" jsonb NOT NULL,
	"award" jsonb NOT NULL,
	"summary" text GENERATED ALWAYS AS (CASE selector ->> 'by'
				WHEN 'WAGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'WAGE_AND_AGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · age ' || (selector ->> 'age_from') || '–' || COALESCE(selector ->> 'age_to', '∞')
				WHEN 'WAGE_AND_MARITAL' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · ' || LOWER(selector ->> 'marital')
				WHEN 'HEADCOUNT' THEN 'headcount ' || (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'RISK_CLASS' THEN 'risk ' || (selector ->> 'class')
				ELSE 'band'
			END) STORED
);

--> statement-breakpoint
CREATE TABLE "employee_children" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"child_birthdate" timestamp with time zone NOT NULL,
	"relationship" text NOT NULL,
	"effective_range" jsonb,
	"supersedes_id" uuid
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
	"spouse_status" text,
	"nationality" text,
	"identity_number" text,
	"dependents_count" integer DEFAULT 0 NOT NULL,
	"email" text,
	"phone" text,
	"address" jsonb,
	"user_id" uuid
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
	"employment_id" uuid NOT NULL,
	"statutory_contribution_id" uuid NOT NULL,
	"supersedes_fact_id" uuid,
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
	"base_salary" jsonb NOT NULL,
	"pay_frequency" text NOT NULL,
	"work_classification" text NOT NULL,
	"statutory_work_category" text DEFAULT 'NON_MANUAL' NOT NULL,
	"employment_type" text NOT NULL,
	"department" text,
	"job_title" text,
	"payroll_group" text,
	"work_pattern" jsonb NOT NULL,
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
	"hire_date" timestamp with time zone NOT NULL,
	"exit_date" timestamp with time zone,
	"exit_reason" text,
	"bank" jsonb,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text NOT NULL,
	"tax_year_start_month" integer NOT NULL,
	"proration" jsonb NOT NULL,
	"ordinary_rate_basis" text NOT NULL,
	"ordinary_rate_divisor" numeric NOT NULL,
	"regime" jsonb NOT NULL,
	"statutory_leave" jsonb NOT NULL,
	"successor_profile_id" uuid,
	"void_reason" text,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END), ''))) STORED,
	"employment_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"certificate_file" jsonb,
	"kind" text GENERATED ALWAYS AS (event ->> 'kind') STORED,
	"from_date" timestamp with time zone GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_instant(event #>> '{range,start,date}') ELSE bolt_instant(event ->> 'effective_on') END) STORED,
	"to_date" timestamp with time zone GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_instant(event #>> '{range,end,date}') ELSE bolt_instant(event ->> 'effective_on') END) STORED,
	"days" numeric GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event ->> 'chargeable_days')::numeric ELSE (event ->> 'movement_days')::numeric END) STORED,
	"half_day_start" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,start,half}') = 'SECOND' ELSE false END) STORED,
	"half_day_end" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,end,half}') = 'FIRST' ELSE false END) STORED,
	"reason" text GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN event ->> 'reason' ELSE event ->> 'note' END) STORED,
	"summary" text GENERATED ALWAYS AS (CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END) STORED
);

--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"company_id" uuid NOT NULL,
	"statutory_profile_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"statutory_kind" text,
	"eligibility" jsonb NOT NULL,
	"encash_on_exit" boolean NOT NULL,
	"requires_certificate_after_days" integer,
	"accrual" jsonb NOT NULL,
	"entitlement" jsonb NOT NULL,
	"payroll_effect" jsonb NOT NULL
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
	"due_date" timestamp with time zone NOT NULL,
	"amount_due" numeric NOT NULL,
	"sequence" integer NOT NULL
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
	"pay_component_id" uuid NOT NULL,
	"principal" numeric NOT NULL,
	"effective_range" jsonb NOT NULL,
	"reference" text,
	"reason" text
);

--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"company_id" uuid NOT NULL,
	"statutory_profile_id" uuid NOT NULL,
	"code" text NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"sequence" integer NOT NULL,
	"eligibility" jsonb NOT NULL,
	"definition" jsonb NOT NULL
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
	"lifecycle" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"statutory_snapshot_id" uuid NOT NULL,
	"calculation_version" text NOT NULL,
	"pay_date" timestamp with time zone NOT NULL,
	"attendance_from" timestamp with time zone NOT NULL,
	"attendance_to" timestamp with time zone NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("label", ''))) STORED,
	"payslip_id" uuid NOT NULL,
	"period" text NOT NULL,
	"input__work_day_input_id" uuid,
	"input__component_entry_input_id" uuid,
	"input__leave_request_input_id" uuid,
	"input__loan_repayment_input_id" uuid,
	"label" text NOT NULL,
	"bucket" text NOT NULL,
	"amount" numeric NOT NULL,
	"quantity" numeric,
	"rate" numeric,
	"statutory_rule_key" text,
	"sequence" integer NOT NULL,
	CONSTRAINT "payslip_adjustments_input_reference_check" CHECK (num_nonnulls("input__work_day_input_id", "input__component_entry_input_id", "input__leave_request_input_id", "input__loan_repayment_input_id") = 1)
);

--> statement-breakpoint
CREATE TABLE "payslip_component_entry_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"component_entry_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_leave_request_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_loan_repayment_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"loan_repayment_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_work_day_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"work_day_id" uuid NOT NULL,
	"period" text NOT NULL
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
	"base" jsonb NOT NULL,
	"proration" jsonb NOT NULL,
	"statutory" jsonb NOT NULL,
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
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("month", ''))) STORED,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"published_at" timestamp with time zone
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
CREATE TABLE "statutory_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"jurisdiction_id" uuid NOT NULL,
	"statutory_profile_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"authority" text NOT NULL,
	"payer" text NOT NULL,
	"keyed_by" text NOT NULL,
	"rounding" text NOT NULL,
	"relief_for" uuid[] NOT NULL,
	"sequence" integer NOT NULL,
	"special_rules" text[] NOT NULL,
	"overtime_treatments" jsonb NOT NULL,
	"overtime_excess_treatments" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "statutory_profile_drift_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("error", '') || ' ' || coalesce("web_summary", ''))) STORED,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"local_findings_count" integer NOT NULL,
	"local_findings" jsonb NOT NULL,
	"successor_proposals_count" integer NOT NULL,
	"successor_proposals" jsonb NOT NULL,
	"web_summary" text,
	"web_highlights" jsonb,
	"official_sources" jsonb,
	"changes_to_review" jsonb,
	"error" text
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
	"roster_id" uuid,
	"assignment_code" text,
	"planned_origin" text,
	"planned_note" text,
	"worked_intervals" jsonb,
	"break_minutes" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
CREATE INDEX "companies_search_document_gin_idx" ON "companies" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "companies_search_text_trgm_idx" ON "companies" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "company_holidays_search_document_gin_idx" ON "company_holidays" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "company_holidays_search_text_trgm_idx" ON "company_holidays" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "component_entries_employment_id_pay_period_index" ON "component_entries" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "component_entries_pay_component_id_index" ON "component_entries" ("pay_component_id");
--> statement-breakpoint
CREATE INDEX "component_entries_employment_id_event_date_index" ON "component_entries" ("employment_id","event_date");
--> statement-breakpoint
CREATE INDEX "component_entries_corrects_adjustment_id_index" ON "component_entries" ("corrects_adjustment_id") WHERE "corrects_adjustment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "contribution_rates_search_document_gin_idx" ON "contribution_rates" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "contribution_rates_search_text_trgm_idx" ON "contribution_rates" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employee_children_employment_id_index" ON "employee_children" ("employment_id");
--> statement-breakpoint
CREATE INDEX "employee_children_supersedes_id_index" ON "employee_children" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;
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
CREATE UNIQUE INDEX "employments_company_id_employee_number_index" ON "employments" ("company_id","employee_number");
--> statement-breakpoint
CREATE INDEX "employments_search_document_gin_idx" ON "employments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employments_search_text_trgm_idx" ON "employments" USING gin ((coalesce("employee_number", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "jurisdictions_code_index" ON "jurisdictions" ("code");
--> statement-breakpoint
CREATE INDEX "jurisdictions_lifecycle_index" ON "jurisdictions" ("lifecycle");
--> statement-breakpoint
CREATE INDEX "jurisdictions_search_document_gin_idx" ON "jurisdictions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jurisdictions_search_text_trgm_idx" ON "jurisdictions" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_requests_employment_id_leave_type_id_from_date_index" ON "leave_requests" ("employment_id","leave_type_id","from_date");
--> statement-breakpoint
CREATE INDEX "leave_requests_search_document_gin_idx" ON "leave_requests" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_requests_search_text_trgm_idx" ON "leave_requests" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_company_id_code_index" ON "leave_types" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "leave_types_statutory_profile_id_index" ON "leave_types" ("statutory_profile_id");
--> statement-breakpoint
CREATE INDEX "leave_types_search_document_gin_idx" ON "leave_types" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_types_search_text_trgm_idx" ON "leave_types" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_repayments_loan_id_sequence_index" ON "loan_repayments" ("loan_id","sequence");
--> statement-breakpoint
CREATE INDEX "loans_employment_id_index" ON "loans" ("employment_id");
--> statement-breakpoint
CREATE INDEX "loans_pay_component_id_index" ON "loans" ("pay_component_id");
--> statement-breakpoint
CREATE INDEX "loans_search_document_gin_idx" ON "loans" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loans_search_text_trgm_idx" ON "loans" USING gin ((coalesce("reference", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "pay_components_company_id_code_index" ON "pay_components" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "pay_components_statutory_profile_id_index" ON "pay_components" ("statutory_profile_id");
--> statement-breakpoint
CREATE INDEX "pay_components_search_document_gin_idx" ON "pay_components" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "pay_components_search_text_trgm_idx" ON "pay_components" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_id_period_index" ON "payroll_runs" ("company_id","period");
--> statement-breakpoint
CREATE INDEX "payroll_runs_statutory_snapshot_id_index" ON "payroll_runs" ("statutory_snapshot_id");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_document_gin_idx" ON "payroll_runs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_text_trgm_idx" ON "payroll_runs" USING gin ((coalesce("period", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_payslip_id_index" ON "payslip_adjustments" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_statutory_rule_key_index" ON "payslip_adjustments" ("statutory_rule_key") WHERE "statutory_rule_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_search_document_gin_idx" ON "payslip_adjustments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_search_text_trgm_idx" ON "payslip_adjustments" USING gin ((coalesce("label", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_work_day_input_ref_idx" ON "payslip_adjustments" ("input__work_day_input_id") WHERE "input__work_day_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_component_entry_input_ref_idx" ON "payslip_adjustments" ("input__component_entry_input_id") WHERE "input__component_entry_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_leave_request_input_ref_idx" ON "payslip_adjustments" ("input__leave_request_input_id") WHERE "input__leave_request_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_loan_repayment_input_ref_idx" ON "payslip_adjustments" ("input__loan_repayment_input_id") WHERE "input__loan_repayment_input_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_component_entry_inputs_payslip_id_component_entry_id_index" ON "payslip_component_entry_inputs" ("payslip_id","component_entry_id");
--> statement-breakpoint
CREATE INDEX "payslip_component_entry_inputs_component_entry_id_index" ON "payslip_component_entry_inputs" ("component_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_leave_request_inputs_payslip_id_leave_request_id_index" ON "payslip_leave_request_inputs" ("payslip_id","leave_request_id");
--> statement-breakpoint
CREATE INDEX "payslip_leave_request_inputs_leave_request_id_index" ON "payslip_leave_request_inputs" ("leave_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_loan_repayment_inputs_payslip_id_loan_repayment_id_index" ON "payslip_loan_repayment_inputs" ("payslip_id","loan_repayment_id");
--> statement-breakpoint
CREATE INDEX "payslip_loan_repayment_inputs_loan_repayment_id_index" ON "payslip_loan_repayment_inputs" ("loan_repayment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_work_day_inputs_payslip_id_work_day_id_index" ON "payslip_work_day_inputs" ("payslip_id","work_day_id");
--> statement-breakpoint
CREATE INDEX "payslip_work_day_inputs_work_day_id_index" ON "payslip_work_day_inputs" ("work_day_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_payroll_run_id_employment_id_index" ON "payslips" ("payroll_run_id","employment_id");
--> statement-breakpoint
CREATE INDEX "payslips_search_document_gin_idx" ON "payslips" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslips_search_text_trgm_idx" ON "payslips" USING gin ((coalesce("currency", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_company_id_month_index" ON "rosters" ("company_id","month");
--> statement-breakpoint
CREATE INDEX "rosters_search_document_gin_idx" ON "rosters" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "rosters_search_text_trgm_idx" ON "rosters" USING gin ((coalesce("month", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definitions_company_id_code_index" ON "shift_definitions" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_document_gin_idx" ON "shift_definitions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_text_trgm_idx" ON "shift_definitions" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_contributions_statutory_profile_id_code_index" ON "statutory_contributions" ("statutory_profile_id","code");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_jurisdiction_id_index" ON "statutory_contributions" ("jurisdiction_id");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_search_document_gin_idx" ON "statutory_contributions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "statutory_contributions_search_text_trgm_idx" ON "statutory_contributions" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "statutory_profile_drift_logs_checked_at_index" ON "statutory_profile_drift_logs" ("checked_at");
--> statement-breakpoint
CREATE INDEX "statutory_profile_drift_logs_status_index" ON "statutory_profile_drift_logs" ("status");
--> statement-breakpoint
CREATE INDEX "statutory_profile_drift_logs_search_document_gin_idx" ON "statutory_profile_drift_logs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "statutory_profile_drift_logs_search_text_trgm_idx" ON "statutory_profile_drift_logs" USING gin ((coalesce("error", '') || ' ' || coalesce("web_summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "work_days_employment_id_work_date_index" ON "work_days" ("employment_id","work_date");
--> statement-breakpoint
CREATE INDEX "work_days_roster_id_index" ON "work_days" ("roster_id") WHERE "roster_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "work_days_work_date_index" ON "work_days" ("work_date");
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_jurisdiction_id_jurisdictions_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_pay_component_id_pay_components_fk" FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id");
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_corrects_adjustment_id_payslip_adjustments_fk" FOREIGN KEY ("corrects_adjustment_id") REFERENCES "payslip_adjustments"("id");
--> statement-breakpoint
ALTER TABLE "contribution_rates" ADD CONSTRAINT "contribution_rates_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employee_children" ADD CONSTRAINT "employee_children_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employee_children" ADD CONSTRAINT "employee_children_supersedes_id_employee_children_fk" FOREIGN KEY ("supersedes_id") REFERENCES "employee_children"("id");
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("id");
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_employee_id_employees_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");
--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_fk" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id");
--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_loans_fk" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_pay_component_id_pay_components_fk" FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id");
--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_statutory_profile_id_jurisdictions_fk" FOREIGN KEY ("statutory_profile_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_statutory_snapshot_id_jurisdictions_fk" FOREIGN KEY ("statutory_snapshot_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_work_day_input_fk" FOREIGN KEY ("input__work_day_input_id") REFERENCES "payslip_work_day_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_component_entry_input_fk" FOREIGN KEY ("input__component_entry_input_id") REFERENCES "payslip_component_entry_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_leave_request_input_fk" FOREIGN KEY ("input__leave_request_input_id") REFERENCES "payslip_leave_request_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_loan_repayment_input_fk" FOREIGN KEY ("input__loan_repayment_input_id") REFERENCES "payslip_loan_repayment_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_component_entry_inputs" ADD CONSTRAINT "payslip_component_entry_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_component_entry_inputs" ADD CONSTRAINT "payslip_component_entry_inputs_component_entry_id_component_entries_fk" FOREIGN KEY ("component_entry_id") REFERENCES "component_entries"("id");
--> statement-breakpoint
ALTER TABLE "payslip_leave_request_inputs" ADD CONSTRAINT "payslip_leave_request_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_leave_request_inputs" ADD CONSTRAINT "payslip_leave_request_inputs_leave_request_id_leave_requests_fk" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id");
--> statement-breakpoint
ALTER TABLE "payslip_loan_repayment_inputs" ADD CONSTRAINT "payslip_loan_repayment_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_loan_repayment_inputs" ADD CONSTRAINT "payslip_loan_repayment_inputs_loan_repayment_id_loan_repayments_fk" FOREIGN KEY ("loan_repayment_id") REFERENCES "loan_repayments"("id");
--> statement-breakpoint
ALTER TABLE "payslip_work_day_inputs" ADD CONSTRAINT "payslip_work_day_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_work_day_inputs" ADD CONSTRAINT "payslip_work_day_inputs_work_day_id_work_days_fk" FOREIGN KEY ("work_day_id") REFERENCES "work_days"("id");
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_jurisdiction_id_jurisdictions_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_statutory_profile_id_jurisdictions_fk" FOREIGN KEY ("statutory_profile_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_shift_definition_id_shift_definitions_fk" FOREIGN KEY ("shift_definition_id") REFERENCES "shift_definitions"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_roster_id_rosters_fk" FOREIGN KEY ("roster_id") REFERENCES "rosters"("id");
