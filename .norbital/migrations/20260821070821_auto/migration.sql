CREATE TABLE "suspicious_activity_logs" (
	"norbital_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"norbital_created_at" timestamp with time zone DEFAULT now(),
	"norbital_updated_at" timestamp with time zone DEFAULT now(),
	"norbital_sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"norbital_row_version" integer DEFAULT 1,
	"norbital_approval_id" uuid,
	"job_assignment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);

--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_job_assignment_id_index" ON "suspicious_activity_logs" ("job_assignment_id");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_resolved_at_index" ON "suspicious_activity_logs" ("resolved_at");
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_reason_search_trgm_idx" ON "suspicious_activity_logs" USING gin ("reason" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "suspicious_activity_logs_resolution_search_trgm_idx" ON "suspicious_activity_logs" USING gin ("resolution" gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "suspicious_activity_logs" ADD CONSTRAINT "suspicious_activity_logs_job_assignment_id_job_assignments_fk" FOREIGN KEY ("job_assignment_id") REFERENCES "job_assignments"("norbital_id");
