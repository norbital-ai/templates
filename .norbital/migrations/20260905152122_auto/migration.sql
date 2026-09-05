ALTER TABLE "statutory_profile_drift_logs" ADD COLUMN "run_key" text;
--> statement-breakpoint
ALTER TABLE "statutory_profile_drift_logs" ADD COLUMN "parent_log_id" uuid;
--> statement-breakpoint
ALTER TABLE "statutory_profile_drift_logs" ADD COLUMN "statutory_profile_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_profile_drift_logs_run_key_index" ON "statutory_profile_drift_logs" ("run_key");
--> statement-breakpoint
CREATE INDEX "statutory_profile_drift_logs_parent_log_id_statutory_profile_id_index" ON "statutory_profile_drift_logs" ("parent_log_id","statutory_profile_id");
