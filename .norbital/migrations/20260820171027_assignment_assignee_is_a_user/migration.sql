ALTER TABLE "job_assignments" DROP CONSTRAINT "job_assignments_contractor_profile_id_contractor_profiles_fk";
--> statement-breakpoint
DROP INDEX "job_assignments_contractor_profile_id_index";
--> statement-breakpoint
ALTER TABLE "job_assignments" RENAME COLUMN "contractor_profile_id" TO "assignee_user_id";
--> statement-breakpoint
UPDATE "job_assignments" SET "assignee_user_id" = "contractor_profiles"."user_id" FROM "contractor_profiles" WHERE "contractor_profiles"."norbital_id" = "job_assignments"."assignee_user_id";
--> statement-breakpoint
DROP TABLE "contractor_profiles";
--> statement-breakpoint
CREATE INDEX "job_assignments_assignee_user_id_index" ON "job_assignments" ("assignee_user_id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_assignee_user_id_user_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "bolt_auth_user"("norbital_id");
