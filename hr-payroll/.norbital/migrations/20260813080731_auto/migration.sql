-- RESET ONLY: the removed tables are folded into jurisdictions.regime by the authoritative seed.
-- Do not apply this migration in place to a populated tenant; use the planned environment reset.
DROP TABLE "overtime_coverage_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "overtime_coverage_rules_history";
--> statement-breakpoint
DROP TABLE "overtime_limits";
--> statement-breakpoint
DROP TABLE IF EXISTS "overtime_limits_history";
--> statement-breakpoint
DROP TABLE "overtime_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "overtime_rules_history";
--> statement-breakpoint
DROP TABLE "rest_break_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "rest_break_rules_history";
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "regime" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdictions_history" ADD COLUMN "regime" jsonb NOT NULL;
