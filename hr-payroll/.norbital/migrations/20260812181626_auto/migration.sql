ALTER TABLE "employment_terms" DROP CONSTRAINT "employment_terms_work_pattern_id_work_patterns_fk";
--> statement-breakpoint
ALTER TABLE "rosters" DROP CONSTRAINT "rosters_work_pattern_id_work_patterns_fk";
--> statement-breakpoint
DROP TABLE "work_patterns";
--> statement-breakpoint
DROP TABLE IF EXISTS "work_patterns_history";
--> statement-breakpoint
DROP INDEX "rosters_company_id_work_pattern_id_month_index";
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "work_pattern" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "employment_terms_history" ADD COLUMN "work_pattern" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "variant" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" ADD COLUMN "variant" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "worked_intervals" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries_history" ADD COLUMN "worked_intervals" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP COLUMN "ordinary_hours_per_week";
--> statement-breakpoint
ALTER TABLE "employment_terms_history" DROP COLUMN "ordinary_hours_per_week";
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP COLUMN "working_days_per_week";
--> statement-breakpoint
ALTER TABLE "employment_terms_history" DROP COLUMN "working_days_per_week";
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP COLUMN "work_pattern_id";
--> statement-breakpoint
ALTER TABLE "employment_terms_history" DROP COLUMN "work_pattern_id";
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP COLUMN "rest_day";
--> statement-breakpoint
ALTER TABLE "employment_terms_history" DROP COLUMN "rest_day";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "start_time";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "start_time";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "end_time";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "end_time";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "break_minutes";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "break_minutes";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "crosses_midnight";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "crosses_midnight";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "pays_overtime";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "pays_overtime";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "overtime_break_minutes";
--> statement-breakpoint
ALTER TABLE "shift_definitions_history" DROP COLUMN "overtime_break_minutes";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "clock_in";
--> statement-breakpoint
ALTER TABLE "time_entries_history" DROP COLUMN "clock_in";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "clock_out";
--> statement-breakpoint
ALTER TABLE "time_entries_history" DROP COLUMN "clock_out";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "state";
--> statement-breakpoint
ALTER TABLE "time_entries_history" DROP COLUMN "state";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "overtime_in";
--> statement-breakpoint
ALTER TABLE "time_entries_history" DROP COLUMN "overtime_in";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "overtime_out";
--> statement-breakpoint
ALTER TABLE "time_entries_history" DROP COLUMN "overtime_out";
--> statement-breakpoint
ALTER TABLE "roster_entries" DROP COLUMN "designation";
--> statement-breakpoint
ALTER TABLE "roster_entries_history" DROP COLUMN "designation";
--> statement-breakpoint
ALTER TABLE "rosters" DROP COLUMN "work_pattern_id";
--> statement-breakpoint
ALTER TABLE "rosters_history" DROP COLUMN "work_pattern_id";
--> statement-breakpoint
ALTER TABLE "roster_entries" ALTER COLUMN "shift_definition_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "roster_entries_history" ALTER COLUMN "shift_definition_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_company_id_month_index" ON "rosters" ("company_id","month");
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definitions_company_id_code_index" ON "shift_definitions" ("company_id","code");
