DROP INDEX "payroll_runs_company_id_period_index";
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "run_kind" text DEFAULT 'REGULAR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP INDEX "employee_children_supersedes_id_index";
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_children_supersedes_id_index" ON "employee_children" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_id_period_sequence_index" ON "payroll_runs" ("company_id","period","sequence");
