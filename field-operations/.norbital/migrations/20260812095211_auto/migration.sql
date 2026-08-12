ALTER TABLE "job_assignments" ADD COLUMN "site_identity_mismatch" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments_history" ADD COLUMN "site_identity_mismatch" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD COLUMN "site_identity_rationale" text;
--> statement-breakpoint
ALTER TABLE "job_assignments_history" ADD COLUMN "site_identity_rationale" text;
