ALTER TABLE "job_assignments" ADD COLUMN "search_text" text;
--> statement-breakpoint
CREATE INDEX "job_assignments_search_text_search_trgm_idx" ON "job_assignments" USING gin ("search_text" gin_trgm_ops);
