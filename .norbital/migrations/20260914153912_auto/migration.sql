ALTER TABLE "payroll_runs" ADD COLUMN "calculation_trace" jsonb DEFAULT '[]' NOT NULL;
