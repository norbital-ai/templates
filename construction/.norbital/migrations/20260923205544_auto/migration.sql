DROP INDEX "asset_documents_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "bim_reference_matrix_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "certification_types_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "defects_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "job_assignments_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "jobs_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "payment_claims_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "permits_to_work_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "projects_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "rfis_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "site_locations_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "workers_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "asset_documents" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "asset_documents" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "bim_reference_matrix" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "bim_reference_matrix" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reference_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "certification_types" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "certification_types" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("certification_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "job_assignments" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("assignment_code", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("job_title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "payment_claims" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("claim_number", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "permits_to_work" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "permits_to_work" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("permit_number", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("project_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "rfis" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "rfis" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("title", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "site_locations" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "site_locations" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("location_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "workers" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("worker_name", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "asset_documents_search_document_gin_idx" ON "asset_documents" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "bim_reference_matrix_search_document_gin_idx" ON "bim_reference_matrix" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "certification_types_search_document_gin_idx" ON "certification_types" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "defects_search_document_gin_idx" ON "defects" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "job_assignments_search_document_gin_idx" ON "job_assignments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jobs_search_document_gin_idx" ON "jobs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payment_claims_search_document_gin_idx" ON "payment_claims" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "permits_to_work_search_document_gin_idx" ON "permits_to_work" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "projects_search_document_gin_idx" ON "projects" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "rfis_search_document_gin_idx" ON "rfis" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "site_locations_search_document_gin_idx" ON "site_locations" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "workers_search_document_gin_idx" ON "workers" USING gin ("search_document");
