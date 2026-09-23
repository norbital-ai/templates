ALTER TABLE "adhoc_catalogue" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "adhoc_catalogue" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "adhoc_catalogue" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
CREATE INDEX "adhoc_catalogue_record_embedding_hnsw_idx" ON "adhoc_catalogue" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_record_embedding_hnsw_idx" ON "allowance_catalogue" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "claim_catalogue_record_embedding_hnsw_idx" ON "claim_catalogue" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "companies_record_embedding_hnsw_idx" ON "companies" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employees_record_embedding_hnsw_idx" ON "employees" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employment_statutory_facts_record_embedding_hnsw_idx" ON "employment_statutory_facts" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employment_terms_record_embedding_hnsw_idx" ON "employment_terms" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employment_wage_periods_record_embedding_hnsw_idx" ON "employment_wage_periods" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "employments_record_embedding_hnsw_idx" ON "employments" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "jurisdiction_holidays_record_embedding_hnsw_idx" ON "jurisdiction_holidays" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "jurisdiction_settings_record_embedding_hnsw_idx" ON "jurisdiction_settings" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "leave_catalogue_record_embedding_hnsw_idx" ON "leave_catalogue" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "leave_entries_record_embedding_hnsw_idx" ON "leave_entries" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "loan_catalogue_record_embedding_hnsw_idx" ON "loan_catalogue" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "loans_record_embedding_hnsw_idx" ON "loans" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "payment_holds_record_embedding_hnsw_idx" ON "payment_holds" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "payroll_runs_record_embedding_hnsw_idx" ON "payroll_runs" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "payslips_record_embedding_hnsw_idx" ON "payslips" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "shift_definitions_record_embedding_hnsw_idx" ON "shift_definitions" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "shift_patterns_record_embedding_hnsw_idx" ON "shift_patterns" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "statutory_contributions_record_embedding_hnsw_idx" ON "statutory_contributions" USING hnsw ("record_embedding" vector_cosine_ops);
