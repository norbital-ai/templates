CREATE TABLE "payroll_settlements" (
	"norbital_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"norbital_created_at" timestamp with time zone DEFAULT now(),
	"norbital_updated_at" timestamp with time zone DEFAULT now(),
	"norbital_sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"norbital_row_version" integer DEFAULT 1,
	"norbital_approval_id" uuid,
	"payroll_run_id" uuid NOT NULL,
	"source_collection" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
CREATE INDEX "payroll_settlements_payroll_run_id_index" ON "payroll_settlements" ("payroll_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_settlements_source_collection_source_record_id_index" ON "payroll_settlements" ("source_collection","source_record_id");
--> statement-breakpoint
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("norbital_id");
