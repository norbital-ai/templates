CREATE TABLE "communication_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("message", '') || ' ' || coalesce("sender", ''))) STORED,
	"job_assignment_id" uuid NOT NULL,
	"message" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sender" text NOT NULL,
	"source_message_id" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "job_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("search_text", '') || ' ' || coalesce("summary", ''))) STORED,
	"job_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"dispatched_at" timestamp with time zone,
	"status" text,
	"completed_at" timestamp with time zone,
	"amount_charged" jsonb,
	"location" jsonb,
	"summary" text,
	"search_text" text,
	"source_message_id" text,
	"suspicion_checked_at" timestamp with time zone
);

--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("title", ''))) STORED,
	"external_ref" text,
	"site_id" uuid NOT NULL,
	"title" text NOT NULL,
	"nature" text,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text,
	"description" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "photo_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((CASE source ->> 'kind'
				WHEN 'workspace_upload' THEN 'Workspace upload'
				WHEN 'channel' THEN 'From ' || COALESCE(NULLIF(source ->> 'provider', ''), 'a channel') || COALESCE(' · ' || LEFT(source ->> 'sent_at', 10), '')
				ELSE 'Photo'
			END), ''))) STORED,
	"record_embedding" vector(256),
	"embedded_at" timestamp with time zone,
	"record_embedding_fingerprint" text,
	"job_assignment_id" uuid,
	"variation_request_id" uuid,
	"photo" jsonb NOT NULL,
	"source_key" text NOT NULL,
	"source" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"perceptual_embedding" vector(256) NOT NULL,
	"flags" text[] NOT NULL,
	"matched_evidence_ids" uuid[] NOT NULL,
	"summary" text GENERATED ALWAYS AS (CASE source ->> 'kind'
				WHEN 'workspace_upload' THEN 'Workspace upload'
				WHEN 'channel' THEN 'From ' || COALESCE(NULLIF(source ->> 'provider', ''), 'a channel') || COALESCE(' · ' || LEFT(source ->> 'sent_at', 10), '')
				ELSE 'Photo'
			END) STORED
);

--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"site_code" text,
	"name" text NOT NULL,
	"location" jsonb,
	"client_name" text,
	"house_type" text,
	"floor_area_sqm" numeric
);

--> statement-breakpoint
CREATE TABLE "suspicion_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("reason", ''))) STORED,
	"job_assignment_id" uuid NOT NULL,
	"basis_hash" text NOT NULL,
	"basis" text NOT NULL,
	"suspicious" boolean NOT NULL,
	"reason" text NOT NULL,
	"evidence_id" uuid,
	"model" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"source_key" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "suspicious_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("reason", '') || ' ' || coalesce("resolution", ''))) STORED,
	"job_assignment_id" uuid NOT NULL,
	"source_key" text GENERATED ALWAYS AS (origin || ':' || job_assignment_id::text || ':' || md5(basis)) STORED NOT NULL,
	"origin" text DEFAULT 'human' NOT NULL,
	"basis" text,
	"review_id" uuid,
	"evidence_id" uuid,
	"reason" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);

--> statement-breakpoint
CREATE TABLE "variation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("title", ''))) STORED,
	"job_assignment_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"amount" jsonb,
	"source_message_id" text
);

--> statement-breakpoint
CREATE UNIQUE INDEX "communication_logs_source_message_id_index" ON "communication_logs" ("source_message_id");
--> statement-breakpoint
CREATE INDEX "communication_logs_job_assignment_id_idx" ON "communication_logs" ("job_assignment_id");
--> statement-breakpoint
CREATE INDEX "communication_logs_sent_at_idx" ON "communication_logs" ("sent_at");
--> statement-breakpoint
CREATE INDEX "communication_logs_search_document_gin_idx" ON "communication_logs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "communication_logs_search_text_trgm_idx" ON "communication_logs" USING gin ((coalesce("message", '') || ' ' || coalesce("sender", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_source_message_id_index" ON "job_assignments" ("source_message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_job_id_index" ON "job_assignments" ("job_id");
--> statement-breakpoint
CREATE INDEX "job_assignments_assignee_user_id_idx" ON "job_assignments" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX "job_assignments_search_document_gin_idx" ON "job_assignments" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "job_assignments_search_text_trgm_idx" ON "job_assignments" USING gin ((coalesce("search_text", '') || ' ' || coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_external_ref_index" ON "jobs" ("external_ref");
--> statement-breakpoint
CREATE INDEX "jobs_search_document_gin_idx" ON "jobs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "jobs_search_text_trgm_idx" ON "jobs" USING gin ((coalesce("title", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_evidence_source_key_index" ON "photo_evidence" ("source_key");
--> statement-breakpoint
CREATE INDEX "photo_evidence_pdq_hnsw" ON "photo_evidence" USING hnsw ("perceptual_embedding" vector_l2_ops);
--> statement-breakpoint
CREATE INDEX "photo_evidence_search_document_gin_idx" ON "photo_evidence" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "photo_evidence_search_text_trgm_idx" ON "photo_evidence" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "photo_evidence_record_embedding_hnsw_idx" ON "photo_evidence" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "sites_site_code_index" ON "sites" ("site_code");
--> statement-breakpoint
CREATE INDEX "sites_search_document_gin_idx" ON "sites" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sites_search_text_trgm_idx" ON "sites" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "suspicion_reviews_source_key_index" ON "suspicion_reviews" ("source_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "suspicion_reviews_job_assignment_id_basis_hash_index" ON "suspicion_reviews" ("job_assignment_id","basis_hash");
--> statement-breakpoint
CREATE INDEX "suspicion_reviews_reviewed_at_idx" ON "suspicion_reviews" ("reviewed_at");
--> statement-breakpoint
CREATE INDEX "suspicion_reviews_search_document_gin_idx" ON "suspicion_reviews" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suspicion_reviews_search_text_trgm_idx" ON "suspicion_reviews" USING gin ((coalesce("reason", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "suspicious_activity_logs_source_key_index" ON "suspicious_activity_logs" ("source_key");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_job_assignment_id_idx" ON "suspicious_activity_logs" ("job_assignment_id");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_resolved_at_idx" ON "suspicious_activity_logs" ("resolved_at");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_review_id_idx" ON "suspicious_activity_logs" ("review_id");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_search_document_gin_idx" ON "suspicious_activity_logs" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_search_text_trgm_idx" ON "suspicious_activity_logs" USING gin ((coalesce("reason", '') || ' ' || coalesce("resolution", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "variation_requests_source_message_id_index" ON "variation_requests" ("source_message_id");
--> statement-breakpoint
CREATE INDEX "variation_requests_search_document_gin_idx" ON "variation_requests" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "variation_requests_search_text_trgm_idx" ON "variation_requests" USING gin ((coalesce("title", '')) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_jobs_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_assignee_user_id_user_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_variation_request_id_variation_requests_fk" FOREIGN KEY ("variation_request_id") REFERENCES "variation_requests"("id");
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD CONSTRAINT "suspicion_reviews_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "suspicion_reviews" ADD CONSTRAINT "suspicion_reviews_evidence_id_photo_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "photo_evidence"("id");
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD CONSTRAINT "suspicious_activity_logs_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD CONSTRAINT "suspicious_activity_logs_review_id_suspicion_reviews_fk" FOREIGN KEY ("review_id") REFERENCES "suspicion_reviews"("id");
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD CONSTRAINT "suspicious_activity_logs_evidence_id_photo_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "photo_evidence"("id");
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD CONSTRAINT "variation_requests_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
