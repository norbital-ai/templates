ALTER TABLE "asset_documents" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "asset_documents" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "asset_documents" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "bim_reference_matrix" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "bim_reference_matrix" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bim_reference_matrix" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "certification_types" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "certification_types" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "certification_types" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "permits_to_work" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "permits_to_work" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "permits_to_work" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "rfis" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "rfis" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "rfis" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "site_locations" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "site_locations" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "site_locations" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
CREATE INDEX "asset_documents_record_embedding_hnsw_idx" ON "asset_documents" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "bim_reference_matrix_record_embedding_hnsw_idx" ON "bim_reference_matrix" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "certification_types_record_embedding_hnsw_idx" ON "certification_types" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "defects_record_embedding_hnsw_idx" ON "defects" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "job_assignments_record_embedding_hnsw_idx" ON "job_assignments" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "jobs_record_embedding_hnsw_idx" ON "jobs" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "payment_claims_record_embedding_hnsw_idx" ON "payment_claims" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "permits_to_work_record_embedding_hnsw_idx" ON "permits_to_work" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "projects_record_embedding_hnsw_idx" ON "projects" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "rfis_record_embedding_hnsw_idx" ON "rfis" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "site_locations_record_embedding_hnsw_idx" ON "site_locations" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "workers_record_embedding_hnsw_idx" ON "workers" USING hnsw ("record_embedding" vector_cosine_ops);
