CREATE TABLE "payslip_sources" (
	"norbital_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"norbital_created_at" timestamp with time zone DEFAULT now(),
	"norbital_updated_at" timestamp with time zone DEFAULT now(),
	"norbital_sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"norbital_row_version" integer DEFAULT 1,
	"norbital_approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"source_collection" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"period" text NOT NULL
);

--> statement-breakpoint
DROP TABLE "payroll_settlements";
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sources_payslip_id_source_collection_source_record_id_index" ON "payslip_sources" ("payslip_id","source_collection","source_record_id");
--> statement-breakpoint
CREATE INDEX "payslip_sources_source_collection_source_record_id_index" ON "payslip_sources" ("source_collection","source_record_id");
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("norbital_id") ON DELETE CASCADE;
