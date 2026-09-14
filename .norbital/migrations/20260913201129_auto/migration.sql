ALTER TABLE "allowance_requests" DROP CONSTRAINT "allowance_requests_allowance_catalogue_id_allowance_catalogue_fk";
--> statement-breakpoint
ALTER TABLE "claim_requests" DROP CONSTRAINT "claim_requests_claim_catalogue_id_claim_catalogue_fk";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP CONSTRAINT "leave_entries_leave_catalogue_id_leave_catalogue_fk";
--> statement-breakpoint
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_payment_catalogue_id_payment_catalogue_fk";
--> statement-breakpoint
DROP TABLE "payslip_allowance_request_inputs";
--> statement-breakpoint
DROP TABLE "payslip_leave_inputs";
--> statement-breakpoint
DROP TABLE "payslip_loan_repayment_inputs";
--> statement-breakpoint
DROP INDEX "allowance_requests_allowance_catalogue_id_idx";
--> statement-breakpoint
DROP INDEX "claim_requests_claim_catalogue_id_idx";
--> statement-breakpoint
DROP INDEX "payment_requests_payment_catalogue_id_idx";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "nature";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "contribution_treatments";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "settlement";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "cap";
--> statement-breakpoint
ALTER TABLE "allowance_requests" DROP COLUMN "allowance_catalogue_id";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "nature";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "contribution_treatments";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "settlement";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "cap";
--> statement-breakpoint
ALTER TABLE "claim_requests" DROP COLUMN "claim_catalogue_id";
--> statement-breakpoint
ALTER TABLE "claim_requests" DROP COLUMN "settled_payslip_id";
--> statement-breakpoint
ALTER TABLE "claim_requests" DROP COLUMN "settled_period";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "currency";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "tax_year_start_month";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "timezone";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "research_urls";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "minimum_wages";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" DROP COLUMN "treatments";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" DROP COLUMN "requires_certificate_after_days";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "leave_catalogue_id";
--> statement-breakpoint
ALTER TABLE "loan_catalogue" DROP COLUMN "contribution_treatments";
--> statement-breakpoint
ALTER TABLE "payment_catalogue" DROP COLUMN "nature";
--> statement-breakpoint
ALTER TABLE "payment_catalogue" DROP COLUMN "contribution_treatments";
--> statement-breakpoint
ALTER TABLE "payment_catalogue" DROP COLUMN "settlement";
--> statement-breakpoint
ALTER TABLE "payment_catalogue" DROP COLUMN "cap";
--> statement-breakpoint
ALTER TABLE "payment_requests" DROP COLUMN "payment_catalogue_id";
--> statement-breakpoint
ALTER TABLE "payment_requests" DROP COLUMN "settled_payslip_id";
--> statement-breakpoint
ALTER TABLE "payment_requests" DROP COLUMN "settled_period";
--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP COLUMN "withheld";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "settled_payslip_id";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "settled_period";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "destination" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "direction" text;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "bands" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "prorates" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "on_day" integer;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD COLUMN "catalogue_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "destination" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "direction" text;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "bands" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD COLUMN "catalogue_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "payroll" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "wages" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "sources" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "sequence" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "destination" text DEFAULT 'PAY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "direction" text;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "bands" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "evidence" text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "evidence_after_days" integer;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "convertor" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "catalogue_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "as_adjustment_entry" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "destination" text DEFAULT 'NET' NOT NULL;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "direction" text DEFAULT 'SUBTRACT';
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "bands" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD COLUMN "as_adjustment_entry" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "loan_repayments" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "destination" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "direction" text;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "bands" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "catalogue_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_days" ADD COLUMN "payslip_id" uuid;
--> statement-breakpoint
CREATE INDEX "allowance_requests_catalogue_id_idx" ON "allowance_requests" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "allowance_requests_payslip_id_idx" ON "allowance_requests" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "claim_requests_catalogue_id_idx" ON "claim_requests" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "claim_requests_payslip_id_idx" ON "claim_requests" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "leave_entries_payslip_id_idx" ON "leave_entries" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "loan_repayments_payslip_id_idx" ON "loan_repayments" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "payment_requests_catalogue_id_idx" ON "payment_requests" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "payment_requests_payslip_id_idx" ON "payment_requests" ("payslip_id");
--> statement-breakpoint
ALTER TABLE "allowance_requests" ADD CONSTRAINT "allowance_requests_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "allowance_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_catalogue_id_claim_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "claim_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_catalogue_id_leave_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "leave_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_catalogue_id_payment_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "payment_catalogue"("id");
