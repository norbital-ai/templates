ALTER TABLE "employees" ADD COLUMN "face_embedding" vector(1024);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_photo" jsonb;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_enrollment_status" text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_consent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_enrolled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_last_match_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "face_match_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "employees_face_embedding_hnsw" ON "employees" USING hnsw ("face_embedding" vector_cosine_ops);
