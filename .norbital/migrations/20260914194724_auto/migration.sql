ALTER TABLE "employment_statutory_facts" ADD COLUMN "employee_id" uuid;
--> statement-breakpoint
UPDATE "employment_statutory_facts" AS "f" SET "employee_id" = "em"."employee_id" FROM "employments" AS "em" WHERE "em"."id" = "f"."employment_id";
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ALTER COLUMN "employee_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" DROP CONSTRAINT "employment_statutory_facts_employment_id_employments_fk";
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" DROP COLUMN "employment_id";
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_employee_id_employees_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
