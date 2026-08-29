ALTER TABLE "photo_evidence" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
CREATE INDEX "photo_evidence_record_embedding_hnsw_idx" ON "photo_evidence" USING hnsw ("record_embedding" vector_cosine_ops);
