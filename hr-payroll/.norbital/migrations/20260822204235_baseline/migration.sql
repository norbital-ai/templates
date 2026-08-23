CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
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
	"company_id" uuid NOT NULL,
	"date" date NOT NULL,
	"substitutes_date" date,
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
	"event_date" date NOT NULL,
	"pay_period" text,
	"description" text,
	"origin" jsonb NOT NULL,
	"usage_mode" text GENERATED ALWAYS AS (CASE WHEN origin ->> 'kind' = 'RECURRING' THEN 'RECURRING' ELSE 'SINGLE_USE' END) STORED,
	"repayment_agreement_id" uuid GENERATED ALWAYS AS (CASE WHEN origin ->> 'kind' = 'LOAN_INSTALMENT' THEN (origin ->> 'agreement_id')::uuid END) STORED,
	"repayment_sequence" integer GENERATED ALWAYS AS (CASE WHEN origin ->> 'kind' = 'LOAN_INSTALMENT' THEN (origin ->> 'sequence')::integer END) STORED
);

--> statement-breakpoint
CREATE TABLE "contribution_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"statutory_contribution_id" uuid NOT NULL,
	"selector" jsonb NOT NULL,
	"award" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL,
	"summary" text GENERATED ALWAYS AS (CASE selector ->> 'by'
				WHEN 'WAGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'WAGE_AND_AGE' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · age ' || (selector ->> 'age_from') || '–' || COALESCE(selector ->> 'age_to', '∞')
				WHEN 'WAGE_AND_MARITAL' THEN (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞') || ' · ' || LOWER(selector ->> 'marital')
				WHEN 'HEADCOUNT' THEN 'headcount ' || (selector ->> 'from') || ' – ' || COALESCE(selector ->> 'to', '∞')
				WHEN 'RISK_CLASS' THEN 'risk ' || (selector ->> 'class')
				ELSE 'band'
			END || ' · from ' || LEFT(effective_range ->> 'start', 10)) STORED
);

--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"name" text NOT NULL,
	"date_of_birth" date,
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
	"employment_id" uuid NOT NULL,
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
	"employee_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"hire_date" date NOT NULL,
	"exit_date" date,
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
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"tax_year_start_month" integer NOT NULL,
	"proration" jsonb NOT NULL,
	"ordinary_rate_basis" text NOT NULL,
	"ordinary_rate_divisor" numeric NOT NULL,
	"regime" jsonb NOT NULL,
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
	"employment_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"kind" text GENERATED ALWAYS AS (event ->> 'kind') STORED,
	"from_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_date(event #>> '{range,start,date}') ELSE bolt_date(event ->> 'effective_on') END) STORED,
	"to_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_date(event #>> '{range,end,date}') ELSE bolt_date(event ->> 'effective_on') END) STORED,
	"days" numeric GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event ->> 'chargeable_days')::numeric ELSE (event ->> 'movement_days')::numeric END) STORED,
	"half_day_start" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,start,half}') = 'SECOND' ELSE false END) STORED,
	"half_day_end" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,end,half}') = 'FIRST' ELSE false END) STORED,
	"reason" text GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN event ->> 'reason' ELSE event ->> 'note' END) STORED,
	"certificate_file" jsonb GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' AND jsonb_typeof(event -> 'certificate_file') = 'object' THEN event -> 'certificate_file' END) STORED,
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
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"eligibility" jsonb NOT NULL,
	"aggregates_with" text,
	"encash_on_exit" boolean NOT NULL,
	"requires_certificate_after_days" integer,
	"accrual" jsonb NOT NULL,
	"entitlement" jsonb NOT NULL,
	"payroll_effect" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"policy" jsonb NOT NULL,
	"nature" text GENERATED ALWAYS AS (policy ->> 'kind') STORED,
	"sequence" integer NOT NULL,
	"eligibility" jsonb NOT NULL,
	"definition" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"lifecycle" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"pay_date" date NOT NULL,
	"attendance_from" date NOT NULL,
	"attendance_to" date NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"component" jsonb NOT NULL,
	"pay_component_id" uuid GENERATED ALWAYS AS (CASE WHEN component ? 'pay_component_id' THEN (component ->> 'pay_component_id')::uuid END) STORED,
	"component_entry_id" uuid GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' IN ('COMPONENT_ENTRY_ONCE', 'COMPONENT_ENTRY_RECURRING') THEN (component ->> 'component_entry_id')::uuid END) STORED,
	"component_entry_usage" text GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'COMPONENT_ENTRY_ONCE' THEN 'SINGLE_USE' WHEN component ->> 'kind' = 'COMPONENT_ENTRY_RECURRING' THEN 'RECURRING' END) STORED,
	"statutory_contribution_id" uuid GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' IN ('STATUTORY_EMPLOYEE', 'STATUTORY_EMPLOYER') THEN (component ->> 'statutory_contribution_id')::uuid END) STORED,
	"repayment_agreement_id" uuid GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'agreement_id')::uuid END) STORED,
	"repayment_sequence" integer GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'sequence')::integer END) STORED,
	"bucket" text NOT NULL,
	"amount" numeric NOT NULL,
	"quantity" numeric,
	"rate" numeric,
	"sequence" integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"source__time_entry_id" uuid,
	"source__leave_request_id" uuid,
	"period" text NOT NULL,
	CONSTRAINT "payslip_sources_source_reference_check" CHECK (num_nonnulls("source__time_entry_id", "source__leave_request_id") = 1)
);

--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payroll_run_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"gross" numeric NOT NULL,
	"total_deductions" numeric NOT NULL,
	"net" numeric NOT NULL,
	"employer_cost" numeric NOT NULL,
	"currency" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "repayment_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"pay_component_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"principal" numeric NOT NULL,
	"schedule" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"shift_definition_id" uuid NOT NULL,
	"roster_id" uuid,
	"assignment_code" text,
	"origin" text DEFAULT 'MANUAL' NOT NULL,
	"note" text
);

--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
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
	"jurisdiction_id" uuid NOT NULL,
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
	"overtime_excess_treatments" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"worked_intervals" jsonb NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
CREATE INDEX "companies_name_search_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "company_holidays_name_search_trgm_idx" ON "company_holidays" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_entries_id_pay_component_id_usage_mode_index" ON "component_entries" ("id","pay_component_id","usage_mode");
--> statement-breakpoint
CREATE INDEX "component_entries_employment_id_pay_period_index" ON "component_entries" ("employment_id","pay_period");
--> statement-breakpoint
CREATE INDEX "component_entries_pay_component_id_index" ON "component_entries" ("pay_component_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "component_entries_repayment_agreement_id_repayment_sequence_index" ON "component_entries" ("repayment_agreement_id","repayment_sequence") WHERE "repayment_agreement_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "component_entries_repayment_agreement_id_index" ON "component_entries" ("repayment_agreement_id") WHERE "repayment_agreement_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "contribution_rates_summary_search_trgm_idx" ON "contribution_rates" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employees_name_search_trgm_idx" ON "employees" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employment_statutory_facts_summary_search_trgm_idx" ON "employment_statutory_facts" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "employment_terms_summary_search_trgm_idx" ON "employment_terms" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "employments_company_id_employee_number_index" ON "employments" ("company_id","employee_number");
--> statement-breakpoint
CREATE INDEX "employments_employee_number_search_trgm_idx" ON "employments" USING gin ("employee_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "jurisdictions_name_search_trgm_idx" ON "jurisdictions" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_requests_employment_id_leave_type_id_from_date_index" ON "leave_requests" ("employment_id","leave_type_id","from_date");
--> statement-breakpoint
CREATE INDEX "leave_requests_summary_search_trgm_idx" ON "leave_requests" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_types_code_search_trgm_idx" ON "leave_types" USING gin ("code" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "leave_types_name_search_trgm_idx" ON "leave_types" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "pay_components_code_search_trgm_idx" ON "pay_components" USING gin ("code" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_id_period_index" ON "payroll_runs" ("company_id","period");
--> statement-breakpoint
CREATE INDEX "payroll_runs_period_search_trgm_idx" ON "payroll_runs" USING gin ("period" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "payslip_lines_payslip_id_index" ON "payslip_lines" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "payslip_lines_pay_component_id_index" ON "payslip_lines" ("pay_component_id");
--> statement-breakpoint
CREATE INDEX "payslip_lines_statutory_contribution_id_index" ON "payslip_lines" ("statutory_contribution_id") WHERE "statutory_contribution_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_component_entry_id_payslip_id_index" ON "payslip_lines" ("component_entry_id","payslip_id") WHERE "component_entry_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_component_entry_id_index" ON "payslip_lines" ("component_entry_id") WHERE "component_entry_usage" = 'SINGLE_USE';
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_repayment_agreement_id_repayment_sequence_index" ON "payslip_lines" ("repayment_agreement_id","repayment_sequence") WHERE "repayment_agreement_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payslip_sources_payslip_id_index" ON "payslip_sources" ("payslip_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sources_source_time_entry_ref_idx" ON "payslip_sources" ("source__time_entry_id") WHERE "source__time_entry_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sources_source_leave_request_ref_idx" ON "payslip_sources" ("source__leave_request_id") WHERE "source__leave_request_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_payroll_run_id_employment_id_index" ON "payslips" ("payroll_run_id","employment_id");
--> statement-breakpoint
CREATE INDEX "payslips_currency_search_trgm_idx" ON "payslips" USING gin ("currency" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "repayment_agreements_reference_search_trgm_idx" ON "repayment_agreements" USING gin ("reference" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "roster_entries_employment_id_work_date_index" ON "roster_entries" ("employment_id","work_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_company_id_month_index" ON "rosters" ("company_id","month");
--> statement-breakpoint
CREATE INDEX "rosters_month_search_trgm_idx" ON "rosters" USING gin ("month" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definitions_company_id_code_index" ON "shift_definitions" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_definitions_code_search_trgm_idx" ON "shift_definitions" USING gin ("code" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "shift_definitions_name_search_trgm_idx" ON "shift_definitions" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "statutory_contributions_code_search_trgm_idx" ON "statutory_contributions" USING gin ("code" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "statutory_contributions_name_search_trgm_idx" ON "statutory_contributions" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "time_entries_employment_id_work_date_index" ON "time_entries" ("employment_id","work_date");
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_jurisdiction_id_jurisdictions_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_pay_component_id_pay_components_fk" FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id");
--> statement-breakpoint
ALTER TABLE "component_entries" ADD CONSTRAINT "component_entries_repayment_agreement_id_repayment_agreements_fk" FOREIGN KEY ("repayment_agreement_id") REFERENCES "repayment_agreements"("id");
--> statement-breakpoint
ALTER TABLE "contribution_rates" ADD CONSTRAINT "contribution_rates_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("id") ON DELETE CASCADE;
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
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_pay_component_id_pay_components_fk" FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id");
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_component_entry_id_component_entries_fk" FOREIGN KEY ("component_entry_id") REFERENCES "component_entries"("id");
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("id");
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_repayment_agreement_id_repayment_agreements_fk" FOREIGN KEY ("repayment_agreement_id") REFERENCES "repayment_agreements"("id");
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_source_time_entry_fk" FOREIGN KEY ("source__time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_source_leave_request_fk" FOREIGN KEY ("source__leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "repayment_agreements" ADD CONSTRAINT "repayment_agreements_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "repayment_agreements" ADD CONSTRAINT "repayment_agreements_pay_component_id_pay_components_fk" FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id");
--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_shift_definition_id_shift_definitions_fk" FOREIGN KEY ("shift_definition_id") REFERENCES "shift_definitions"("id");
--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_roster_id_rosters_fk" FOREIGN KEY ("roster_id") REFERENCES "rosters"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD CONSTRAINT "statutory_contributions_jurisdiction_id_jurisdictions_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
