CREATE TABLE "job_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"job_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"dispatched_at" timestamp with time zone,
	"status" text,
	"completed_at" timestamp with time zone,
	"amount_charged" jsonb,
	"location" jsonb,
	"summary" text,
	"source_message_id" text,
	"site_identity_unverified" boolean DEFAULT true NOT NULL,
	"site_identity_mismatch" boolean DEFAULT false NOT NULL,
	"site_identity_evidence_id" uuid,
	"extracted_site_name" text,
	"extracted_site_location" text,
	"extracted_unit_number" text,
	"site_identity_confidence" text,
	"site_identity_checked_at" timestamp with time zone,
	"site_identity_rationale" text
);

--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"external_ref" text,
	"site_id" uuid NOT NULL,
	"title" text NOT NULL,
	"nature" text,
	"scheduled_for" date NOT NULL,
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
	"job_assignment_id" uuid,
	"variation_request_id" uuid,
	"photo" jsonb NOT NULL,
	"source_key" text NOT NULL,
	"source" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"perceptual_embedding" vector(256) NOT NULL,
	"flags" text[] NOT NULL,
	"matched_evidence_ids" uuid[] NOT NULL,
	"site_identity_status" text DEFAULT 'pending' NOT NULL,
	"site_identity_checked_at" timestamp with time zone,
	"site_identity_error" text,
	"site_identity_review_basis" text,
	"site_identity_reconciled_at" timestamp with time zone,
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
	"site_code" text,
	"name" text NOT NULL,
	"location" jsonb,
	"client_name" text,
	"house_type" text,
	"floor_area_sqm" numeric
);

--> statement-breakpoint
CREATE TABLE "suspicious_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"job_assignment_id" uuid NOT NULL,
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
	"job_assignment_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"amount" jsonb,
	"source_message_id" text
);

--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_source_message_id_index" ON "job_assignments" ("source_message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_job_id_index" ON "job_assignments" ("job_id");
--> statement-breakpoint
CREATE INDEX "job_assignments_assignee_user_id_index" ON "job_assignments" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX "job_assignments_summary_search_trgm_idx" ON "job_assignments" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_external_ref_index" ON "jobs" ("external_ref");
--> statement-breakpoint
CREATE INDEX "jobs_title_search_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_evidence_source_key_index" ON "photo_evidence" ("source_key");
--> statement-breakpoint
CREATE INDEX "photo_evidence_sha256_index" ON "photo_evidence" ("sha256");
--> statement-breakpoint
CREATE INDEX "photo_evidence_pdq_hnsw" ON "photo_evidence" USING hnsw ("perceptual_embedding" vector_l2_ops);
--> statement-breakpoint
CREATE INDEX "photo_evidence_summary_search_trgm_idx" ON "photo_evidence" USING gin ("summary" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "sites_site_code_index" ON "sites" ("site_code");
--> statement-breakpoint
CREATE INDEX "sites_name_search_trgm_idx" ON "sites" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_job_assignment_id_index" ON "suspicious_activity_logs" ("job_assignment_id");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_resolved_at_index" ON "suspicious_activity_logs" ("resolved_at");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_reason_search_trgm_idx" ON "suspicious_activity_logs" USING gin ("reason" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_resolution_search_trgm_idx" ON "suspicious_activity_logs" USING gin ("resolution" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "variation_requests_source_message_id_index" ON "variation_requests" ("source_message_id");
--> statement-breakpoint
CREATE INDEX "variation_requests_title_search_trgm_idx" ON "variation_requests" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_jobs_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_assignee_user_id_user_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "bolt_auth_user"("id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_variation_request_id_variation_requests_fk" FOREIGN KEY ("variation_request_id") REFERENCES "variation_requests"("id");
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD CONSTRAINT "suspicious_activity_logs_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
--> statement-breakpoint
ALTER TABLE "variation_requests" ADD CONSTRAINT "variation_requests_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("id");
