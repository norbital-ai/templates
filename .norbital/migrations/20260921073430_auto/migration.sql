ALTER TABLE "job_assignments" ADD COLUMN "search_text" text;
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("search_text", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("title", ''))) STORED;
--> statement-breakpoint
DROP INDEX "job_assignments_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "job_assignments_search_text_trgm_idx" ON "job_assignments" USING gin ((coalesce("search_text", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("title", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "job_assignments_search_document_gin_idx" ON "job_assignments" USING gin ("search_document");
