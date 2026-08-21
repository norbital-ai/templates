DROP INDEX "payslip_lines_repayment_agreement_id_payslip_id_repayment_sequence_index";
--> statement-breakpoint
DROP INDEX "payslip_sources_payslip_id_source_collection_source_record_id_index";
--> statement-breakpoint
DROP INDEX "payslip_sources_source_collection_source_record_id_index";
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD COLUMN "source" jsonb;

UPDATE "payslip_sources"
SET "source" = CASE "source_collection"
	WHEN 'time_entries' THEN jsonb_build_object('kind', 'TIME_ENTRY', 'time_entry_id', "source_record_id")
	WHEN 'leave_requests' THEN jsonb_build_object('kind', 'LEAVE_REQUEST', 'leave_request_id', "source_record_id")
	ELSE NULL
END;

-- Component entries and loan instalments are already related by real foreign keys on payslip_lines.
-- Catalogue components and repayment agreements are reusable definitions, not consumed records.
DELETE FROM "payslip_sources" WHERE "source" IS NULL;

ALTER TABLE "payslip_sources" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD COLUMN "time_entry_id" uuid GENERATED ALWAYS AS (CASE WHEN source ->> 'kind' = 'TIME_ENTRY' THEN (source ->> 'time_entry_id')::uuid END) STORED;
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD COLUMN "leave_request_id" uuid GENERATED ALWAYS AS (CASE WHEN source ->> 'kind' = 'LEAVE_REQUEST' THEN (source ->> 'leave_request_id')::uuid END) STORED;
--> statement-breakpoint
ALTER TABLE "payslip_sources" DROP COLUMN "source_collection";
--> statement-breakpoint
ALTER TABLE "payslip_sources" DROP COLUMN "source_record_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_repayment_agreement_id_repayment_sequence_index" ON "payslip_lines" ("repayment_agreement_id","repayment_sequence") WHERE "repayment_agreement_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payslip_sources_payslip_id_index" ON "payslip_sources" ("payslip_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sources_time_entry_id_index" ON "payslip_sources" ("time_entry_id") WHERE "time_entry_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sources_leave_request_id_index" ON "payslip_sources" ("leave_request_id") WHERE "leave_request_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_time_entry_id_time_entries_fk" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("norbital_id");
--> statement-breakpoint
ALTER TABLE "payslip_sources" ADD CONSTRAINT "payslip_sources_leave_request_id_leave_requests_fk" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("norbital_id");
