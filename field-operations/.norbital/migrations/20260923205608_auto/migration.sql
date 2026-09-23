DROP INDEX "communication_logs_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "job_assignments_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "photo_evidence_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "sites_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "suspicion_reviews_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "suspicious_activity_logs_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "variation_requests_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "communication_logs" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "communication_logs" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("message", '') || ' ' || coalesce("sender", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("search_text", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "photo_evidence" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce((CASE source ->> 'kind'
				WHEN 'workspace_upload' THEN 'Workspace upload'
				WHEN 'channel' THEN 'From ' || COALESCE(NULLIF(source ->> 'provider', ''), 'a channel') || COALESCE(' · ' || LEFT(source ->> 'sent_at', 10), '')
				ELSE 'Photo'
			END), ''))) STORED;
--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reason", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reason", '') || ' ' || coalesce("resolution", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "variation_requests" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("title", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "communication_logs_search_document_gin_idx" ON "communication_logs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "job_assignments_search_document_gin_idx" ON "job_assignments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "photo_evidence_search_document_gin_idx" ON "photo_evidence" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sites_search_document_gin_idx" ON "sites" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suspicion_reviews_search_document_gin_idx" ON "suspicion_reviews" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_search_document_gin_idx" ON "suspicious_activity_logs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "variation_requests_search_document_gin_idx" ON "variation_requests" USING gin ("search_document");
