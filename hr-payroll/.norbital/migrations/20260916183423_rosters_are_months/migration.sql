ALTER TABLE "rosters" DROP CONSTRAINT "rosters_company_id_companies_fk";
--> statement-breakpoint
ALTER TABLE "work_days" DROP CONSTRAINT "work_days_holiday_id_jurisdiction_holidays_fk";
--> statement-breakpoint
DROP INDEX "rosters_company_id_idx";
--> statement-breakpoint
ALTER TABLE "rosters" DROP COLUMN "company_id";
--> statement-breakpoint
ALTER TABLE "rosters" DROP COLUMN "range";
--> statement-breakpoint
ALTER TABLE "rosters" DROP COLUMN "origin";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "assignment_code";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "planned_origin";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "break_minutes";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "holiday_id";
