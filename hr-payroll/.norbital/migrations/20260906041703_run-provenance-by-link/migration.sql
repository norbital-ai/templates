ALTER TABLE "payroll_runs" DROP COLUMN "configuration_snapshot";
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "core_input_hash" text;
