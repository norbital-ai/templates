ALTER TABLE "employees" ADD COLUMN "children" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "comments" text;
--> statement-breakpoint
UPDATE "employees" AS "e" SET "children" = COALESCE((SELECT jsonb_agg("child"."value") FROM (SELECT DISTINCT "elem"."value" FROM "employments" AS "em" CROSS JOIN LATERAL jsonb_array_elements(COALESCE("em"."children", '[]'::jsonb)) AS "elem"("value") WHERE "em"."employee_id" = "e"."id") AS "child"), '[]'::jsonb);
--> statement-breakpoint
UPDATE "employments" SET "comments" = "exit_note" WHERE "exit_note" IS NOT NULL;
--> statement-breakpoint
DROP INDEX "employments_company_id_employee_number_hire_date_index";
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "hire_date";
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "exit_date";
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "exit_reason";
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "exit_note";
--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "children";
