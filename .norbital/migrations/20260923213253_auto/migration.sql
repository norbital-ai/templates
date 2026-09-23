DROP INDEX "photo_evidence_search_document_gin_idx";
--> statement-breakpoint
ALTER TABLE "photo_evidence" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "communication_logs" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "communication_logs" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "communication_logs" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
CREATE INDEX "communication_logs_record_embedding_hnsw_idx" ON "communication_logs" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "job_assignments_record_embedding_hnsw_idx" ON "job_assignments" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "sites_record_embedding_hnsw_idx" ON "sites" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "suspicion_reviews_record_embedding_hnsw_idx" ON "suspicion_reviews" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_record_embedding_hnsw_idx" ON "suspicious_activity_logs" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "variation_requests_record_embedding_hnsw_idx" ON "variation_requests" USING hnsw ("record_embedding" vector_cosine_ops);
