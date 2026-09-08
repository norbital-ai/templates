CREATE TABLE "allowance_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"contribution_treatments" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "allowance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"allowance_catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"recurrence" jsonb NOT NULL,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"corrects_adjustment_id" uuid,
	"pay_period" text
);

--> statement-breakpoint
CREATE TABLE "claim_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"contribution_treatments" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL
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
	"claim_catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"incurred_on" timestamp with time zone NOT NULL,
	"description" text,
	"evidence_file" jsonb,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"corrects_adjustment_id" uuid,
	"pay_period" text
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
	"risk_class" text,
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
	"spouse_status" text,
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
	"residency_status" text,
	"base_salary" jsonb NOT NULL,
	"pay_frequency" text NOT NULL,
	"work_classification" text NOT NULL,
	"statutory_work_category" text DEFAULT 'NON_MANUAL' NOT NULL,
	"employment_type" text NOT NULL,
	"department" text,
	"job_title" text,
	"payroll_group" text,
	"shift_pattern_id" uuid,
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
	"bank" jsonb,
	"effective_range" jsonb NOT NULL,
	"exit_date" timestamp with time zone,
	"exit_reason" text,
	"exit_note" text,
	"children" jsonb DEFAULT '[]' NOT NULL
);

--> statement-breakpoint
CREATE TABLE "jurisdiction_holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"jurisdiction_code" text NOT NULL,
	"year" integer NOT NULL,
	"revision" integer NOT NULL,
	"observations" jsonb NOT NULL,
	"import_review" jsonb,
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
	"currency" text NOT NULL,
	"tax_year_start_month" integer NOT NULL,
	"research_urls" text[],
	"research_notes" jsonb,
	"holiday_source" jsonb,
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
	"is_statutory" boolean DEFAULT false NOT NULL,
	"authority" text,
	"eligibility" text DEFAULT '' NOT NULL,
	"entitlement" jsonb NOT NULL,
	"payroll_effect" jsonb NOT NULL,
	"encashment" jsonb NOT NULL,
	"requires_certificate_after_days" integer
);

--> statement-breakpoint
CREATE TABLE "leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(((event ->> 'kind') || ' · ' || coalesce(event #>> '{range,start,date}', event ->> 'effective_on')), ''))) STORED,
	"employment_id" uuid NOT NULL,
	"leave_catalogue_id" uuid NOT NULL,
	"leave_code" text NOT NULL,
	"event" jsonb NOT NULL,
	"reference" text NOT NULL,
	"certificate_file" jsonb,
	"charges" jsonb NOT NULL,
	"allocations" jsonb NOT NULL,
	"kind" text GENERATED ALWAYS AS (event ->> 'kind') STORED,
	"effective_on" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(coalesce(event ->> 'effective_on', event #>> '{range,start,date}'))) STORED,
	"due_on" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(event ->> 'due_on')) STORED,
	"from_date" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(event #>> '{range,start,date}')) STORED,
	"to_date" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(event #>> '{range,end,date}')) STORED,
	"days" numeric GENERATED ALWAYS AS (coalesce(event ->> 'chargeable_days', event ->> 'days')::numeric) STORED,
	"half_day_start" boolean GENERATED ALWAYS AS ((event #>> '{range,start,half}') = 'SECOND') STORED,
	"half_day_end" boolean GENERATED ALWAYS AS ((event #>> '{range,end,half}') = 'FIRST') STORED,
	"reason" text GENERATED ALWAYS AS (event ->> 'reason') STORED,
	"reversal_of_id" uuid GENERATED ALWAYS AS ((event ->> 'entry_id')::uuid) STORED,
	"summary" text GENERATED ALWAYS AS ((event ->> 'kind') || ' · ' || coalesce(event #>> '{range,start,date}', event ->> 'effective_on')) STORED
);

--> statement-breakpoint
CREATE TABLE "loan_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"contribution_treatments" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL
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
	"loan_catalogue_id" uuid NOT NULL,
	"principal" numeric NOT NULL,
	"effective_range" jsonb NOT NULL,
	"effective_from" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(effective_range ->> 'start')) STORED,
	"reference" text,
	"reason" text
);

--> statement-breakpoint
CREATE TABLE "payment_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"contribution_treatments" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"eligibility" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"payment_catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"effective_on" timestamp with time zone NOT NULL,
	"covers_periods" jsonb,
	"reason" text NOT NULL,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL,
	"corrects_adjustment_id" uuid,
	"pay_period" text
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
	"holiday_calendars" jsonb NOT NULL,
	"settings_id" uuid NOT NULL,
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
	"input__claim_request_input_id" uuid,
	"input__allowance_request_input_id" uuid,
	"input__payment_request_input_id" uuid,
	"input__leave_input_id" uuid,
	"input__loan_repayment_input_id" uuid,
	"label" text NOT NULL,
	"bucket" text NOT NULL,
	"amount" numeric NOT NULL,
	"quantity" numeric,
	"rate" numeric,
	"statutory_rule_key" text,
	"sequence" integer NOT NULL,
	CONSTRAINT "payslip_adjustments_input_reference_check" CHECK (num_nonnulls("input__work_day_input_id", "input__claim_request_input_id", "input__allowance_request_input_id", "input__payment_request_input_id", "input__leave_input_id", "input__loan_repayment_input_id") = 1)
);

--> statement-breakpoint
CREATE TABLE "payslip_allowance_request_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"allowance_request_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_claim_request_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"claim_request_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_leave_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"leave_entry_id" uuid NOT NULL,
	"period" text NOT NULL,
	"charges" jsonb NOT NULL,
	"gross_amount" jsonb NOT NULL,
	"pay_items" jsonb NOT NULL
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
CREATE TABLE "payslip_payment_request_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"payment_request_id" uuid NOT NULL,
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
	"terms_through" timestamp with time zone NOT NULL,
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
	"is_statutory" boolean DEFAULT true NOT NULL,
	"authority" text NOT NULL,
	"payer" text NOT NULL,
	"keyed_by" text NOT NULL,
	"rounding" text NOT NULL,
	"relief_for" uuid[] NOT NULL,
	"sequence" integer NOT NULL,
	"special_rules" text[] NOT NULL,
	"bands" jsonb DEFAULT '[]' NOT NULL
);

--> statement-breakpoint
CREATE TABLE "work_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", ''))) STORED,
	"settings_id" uuid NOT NULL,
	"code" text NOT NULL,
	"proration" jsonb NOT NULL,
	"ordinary_rate" jsonb NOT NULL,
	"regime" jsonb NOT NULL,
	"salary" jsonb NOT NULL,
	"overtime" jsonb NOT NULL,
	"overtime_excess" jsonb NOT NULL,
	"absence" jsonb
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
	"assignment_code" text,
	"planned_origin" text,
	"planned_note" text,
	"worked_intervals" jsonb,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"holiday_calendar_id" uuid
);

--> statement-breakpoint
CREATE UNIQUE INDEX "allowance_catalogue_settings_id_code_index" ON "allowance_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_document_gin_idx" ON "allowance_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_text_trgm_idx" ON "allowance_catalogue" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "allowance_requests_employment_id_pay_period_index" ON "allowance_requests" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "allowance_requests_allowance_catalogue_id_idx" ON "allowance_requests" ("allowance_catalogue_id");
--> statement-breakpoint
CREATE INDEX "allowance_requests_employment_id_idx" ON "allowance_requests" ("employment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_catalogue_settings_id_code_index" ON "claim_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_document_gin_idx" ON "claim_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_text_trgm_idx" ON "claim_catalogue" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "claim_requests_employment_id_pay_period_index" ON "claim_requests" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "claim_requests_employment_id_incurred_on_index" ON "claim_requests" ("employment_id","incurred_on");
--> statement-breakpoint
CREATE INDEX "claim_requests_claim_catalogue_id_idx" ON "claim_requests" ("claim_catalogue_id");
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
CREATE UNIQUE INDEX "employments_company_id_employee_number_hire_date_index" ON "employments" ("company_id","employee_number","hire_date");
--> statement-breakpoint
CREATE INDEX "employments_search_document_gin_idx" ON "employments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employments_search_text_trgm_idx" ON "employments" USING gin ((coalesce("employee_number", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_holiday_calendars_jurisdiction_code_year_revision_index" ON "jurisdiction_holiday_calendars" ("jurisdiction_code","year","revision");
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
CREATE INDEX "leave_entries_search_document_gin_idx" ON "leave_entries" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_entries_search_text_trgm_idx" ON "leave_entries" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_catalogue_settings_id_code_index" ON "loan_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_document_gin_idx" ON "loan_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_text_trgm_idx" ON "loan_catalogue" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_repayments_loan_id_sequence_index" ON "loan_repayments" ("loan_id","sequence");
--> statement-breakpoint
CREATE INDEX "loan_repayments_employment_id_idx" ON "loan_repayments" ("employment_id");
--> statement-breakpoint
CREATE INDEX "loans_employment_id_idx" ON "loans" ("employment_id");
--> statement-breakpoint
CREATE INDEX "loans_loan_catalogue_id_idx" ON "loans" ("loan_catalogue_id");
--> statement-breakpoint
CREATE INDEX "loans_search_document_gin_idx" ON "loans" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loans_search_text_trgm_idx" ON "loans" USING gin ((coalesce("reference", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_catalogue_settings_id_code_index" ON "payment_catalogue" ("settings_id","code");
--> statement-breakpoint
CREATE INDEX "payment_catalogue_search_document_gin_idx" ON "payment_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payment_catalogue_search_text_trgm_idx" ON "payment_catalogue" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payment_requests_employment_id_pay_period_index" ON "payment_requests" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "payment_requests_employment_id_effective_on_index" ON "payment_requests" ("employment_id","effective_on");
--> statement-breakpoint
CREATE INDEX "payment_requests_payment_catalogue_id_idx" ON "payment_requests" ("payment_catalogue_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_id_period_index" ON "payroll_runs" ("company_id","period");
--> statement-breakpoint
CREATE INDEX "payroll_runs_settings_id_idx" ON "payroll_runs" ("settings_id");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_document_gin_idx" ON "payroll_runs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payroll_runs_search_text_trgm_idx" ON "payroll_runs" USING gin ((coalesce("period", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_statutory_rule_key_index" ON "payslip_adjustments" ("statutory_rule_key") WHERE "statutory_rule_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_payslip_id_idx" ON "payslip_adjustments" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_search_document_gin_idx" ON "payslip_adjustments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_search_text_trgm_idx" ON "payslip_adjustments" USING gin ((coalesce("label", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_work_day_input_ref_idx" ON "payslip_adjustments" ("input__work_day_input_id") WHERE "input__work_day_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_claim_request_input_ref_idx" ON "payslip_adjustments" ("input__claim_request_input_id") WHERE "input__claim_request_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_allowance_request_input_ref_idx" ON "payslip_adjustments" ("input__allowance_request_input_id") WHERE "input__allowance_request_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_payment_request_input_ref_idx" ON "payslip_adjustments" ("input__payment_request_input_id") WHERE "input__payment_request_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_leave_input_ref_idx" ON "payslip_adjustments" ("input__leave_input_id") WHERE "input__leave_input_id" is not null;
--> statement-breakpoint
CREATE INDEX "payslip_adjustments_input_loan_repayment_input_ref_idx" ON "payslip_adjustments" ("input__loan_repayment_input_id") WHERE "input__loan_repayment_input_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_allowance_request_inputs_payslip_id_allowance_request_id_index" ON "payslip_allowance_request_inputs" ("payslip_id","allowance_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_claim_request_inputs_payslip_id_claim_request_id_index" ON "payslip_claim_request_inputs" ("payslip_id","claim_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_claim_request_inputs_claim_request_id_index" ON "payslip_claim_request_inputs" ("claim_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_leave_inputs_payslip_id_leave_entry_id_index" ON "payslip_leave_inputs" ("payslip_id","leave_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_loan_repayment_inputs_payslip_id_loan_repayment_id_index" ON "payslip_loan_repayment_inputs" ("payslip_id","loan_repayment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_payment_request_inputs_payslip_id_payment_request_id_index" ON "payslip_payment_request_inputs" ("payslip_id","payment_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_payment_request_inputs_payment_request_id_index" ON "payslip_payment_request_inputs" ("payment_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_work_day_inputs_payslip_id_work_day_id_index" ON "payslip_work_day_inputs" ("payslip_id","work_day_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_work_day_inputs_work_day_id_index" ON "payslip_work_day_inputs" ("work_day_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_payroll_run_id_employment_id_index" ON "payslips" ("payroll_run_id","employment_id");
--> statement-breakpoint
CREATE INDEX "payslips_search_document_gin_idx" ON "payslips" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payslips_search_text_trgm_idx" ON "payslips" USING gin ((coalesce("currency", '')) gin_trgm_ops);
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
CREATE UNIQUE INDEX "work_catalogue_settings_id_index" ON "work_catalogue" ("settings_id");
--> statement-breakpoint
CREATE INDEX "work_catalogue_search_document_gin_idx" ON "work_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "work_catalogue_search_text_trgm_idx" ON "work_catalogue" USING gin ((coalesce("code", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "work_days_employment_id_work_date_index" ON "work_days" ("employment_id","work_date");
--> statement-breakpoint
CREATE INDEX "work_days_work_date_idx" ON "work_days" ("work_date");
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD CONSTRAINT "allowance_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD CONSTRAINT "allowance_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD CONSTRAINT "allowance_requests_allowance_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("allowance_catalogue_id") REFERENCES "allowance_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD CONSTRAINT "claim_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_claim_catalogue_id_claim_catalogue_fk" FOREIGN KEY ("claim_catalogue_id") REFERENCES "claim_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
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
ALTER TABLE "leave_catalogue" ADD CONSTRAINT "leave_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_catalogue_id_leave_catalogue_fk" FOREIGN KEY ("leave_catalogue_id") REFERENCES "leave_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_reversal_of_id_leave_entries_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "leave_entries"("id");
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD CONSTRAINT "loan_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_loans_fk" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_loan_catalogue_id_loan_catalogue_fk" FOREIGN KEY ("loan_catalogue_id") REFERENCES "loan_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD CONSTRAINT "payment_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payment_catalogue_id_payment_catalogue_fk" FOREIGN KEY ("payment_catalogue_id") REFERENCES "payment_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id");
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_work_day_input_fk" FOREIGN KEY ("input__work_day_input_id") REFERENCES "payslip_work_day_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_claim_request_input_fk" FOREIGN KEY ("input__claim_request_input_id") REFERENCES "payslip_claim_request_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_allowance_request_input_fk" FOREIGN KEY ("input__allowance_request_input_id") REFERENCES "payslip_allowance_request_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_payment_request_input_fk" FOREIGN KEY ("input__payment_request_input_id") REFERENCES "payslip_payment_request_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_leave_input_fk" FOREIGN KEY ("input__leave_input_id") REFERENCES "payslip_leave_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_input_loan_repayment_input_fk" FOREIGN KEY ("input__loan_repayment_input_id") REFERENCES "payslip_loan_repayment_inputs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_adjustments" ADD CONSTRAINT "payslip_adjustments_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_allowance_request_inputs" ADD CONSTRAINT "payslip_allowance_request_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_allowance_request_inputs" ADD CONSTRAINT "payslip_allowance_request_inputs_allowance_request_id_allowance_requests_fk" FOREIGN KEY ("allowance_request_id") REFERENCES "allowance_requests"("id");
--> statement-breakpoint
ALTER TABLE "payslip_claim_request_inputs" ADD CONSTRAINT "payslip_claim_request_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_claim_request_inputs" ADD CONSTRAINT "payslip_claim_request_inputs_claim_request_id_claim_requests_fk" FOREIGN KEY ("claim_request_id") REFERENCES "claim_requests"("id");
--> statement-breakpoint
ALTER TABLE "payslip_leave_inputs" ADD CONSTRAINT "payslip_leave_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_leave_inputs" ADD CONSTRAINT "payslip_leave_inputs_leave_entry_id_leave_entries_fk" FOREIGN KEY ("leave_entry_id") REFERENCES "leave_entries"("id");
--> statement-breakpoint
ALTER TABLE "payslip_loan_repayment_inputs" ADD CONSTRAINT "payslip_loan_repayment_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_loan_repayment_inputs" ADD CONSTRAINT "payslip_loan_repayment_inputs_loan_repayment_id_loan_repayments_fk" FOREIGN KEY ("loan_repayment_id") REFERENCES "loan_repayments"("id");
--> statement-breakpoint
ALTER TABLE "payslip_payment_request_inputs" ADD CONSTRAINT "payslip_payment_request_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_payment_request_inputs" ADD CONSTRAINT "payslip_payment_request_inputs_payment_request_id_payment_requests_fk" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id");
--> statement-breakpoint
ALTER TABLE "payslip_work_day_inputs" ADD CONSTRAINT "payslip_work_day_inputs_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_work_day_inputs" ADD CONSTRAINT "payslip_work_day_inputs_work_day_id_work_days_fk" FOREIGN KEY ("work_day_id") REFERENCES "work_days"("id");
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_catalogue" ADD CONSTRAINT "work_catalogue_settings_id_jurisdiction_settings_fk" FOREIGN KEY ("settings_id") REFERENCES "jurisdiction_settings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_holiday_calendar_id_jurisdiction_holiday_calendars_fk" FOREIGN KEY ("holiday_calendar_id") REFERENCES "jurisdiction_holiday_calendars"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_shift_definition_id_shift_definitions_fk" FOREIGN KEY ("shift_definition_id") REFERENCES "shift_definitions"("id");
