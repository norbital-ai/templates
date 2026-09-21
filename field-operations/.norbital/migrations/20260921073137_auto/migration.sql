ALTER TABLE "job_assignments" DROP CONSTRAINT "job_assignments_job_id_jobs_fk";
--> statement-breakpoint
DROP TABLE "jobs";
--> statement-breakpoint
DROP INDEX "job_assignments_job_id_index";
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "job_id";
--> statement-breakpoint
DROP INDEX "job_assignments_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "job_assignments_search_document_gin_idx";
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "search_text";
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "external_ref" text;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "site_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "nature" text;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "scheduled_for" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("summary", '') || ' ' || coalesce("title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "job_assignments" ALTER COLUMN "assignee_user_id" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "job_assignments_search_text_trgm_idx" ON "job_assignments" USING gin ((coalesce("summary", '') || ' ' || coalesce("title", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_external_ref_index" ON "job_assignments" ("external_ref");
--> statement-breakpoint
CREATE INDEX "job_assignments_scheduled_for_idx" ON "job_assignments" ("scheduled_for");
--> statement-breakpoint
CREATE INDEX "job_assignments_site_id_idx" ON "job_assignments" ("site_id");
--> statement-breakpoint
CREATE INDEX "job_assignments_search_document_gin_idx" ON "job_assignments" USING gin ("search_document");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id");
