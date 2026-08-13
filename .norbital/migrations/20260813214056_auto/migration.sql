ALTER TABLE "payslip_lines" ADD COLUMN "repayment_agreement_id" uuid GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'agreement_id')::uuid END) STORED;
--> statement-breakpoint
ALTER TABLE "payslip_lines_history" ADD COLUMN "repayment_agreement_id" uuid GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'agreement_id')::uuid END) STORED;
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD COLUMN "repayment_sequence" integer GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'sequence')::integer END) STORED;
--> statement-breakpoint
ALTER TABLE "payslip_lines_history" ADD COLUMN "repayment_sequence" integer GENERATED ALWAYS AS (CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'sequence')::integer END) STORED;
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_lines_repayment_agreement_id_payslip_id_repayment_sequence_index" ON "payslip_lines" ("repayment_agreement_id","payslip_id","repayment_sequence") WHERE "repayment_agreement_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_repayment_agreement_id_repayment_agreements_fk" FOREIGN KEY ("repayment_agreement_id") REFERENCES "repayment_agreements"("norbital_id");
