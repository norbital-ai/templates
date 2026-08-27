CREATE UNIQUE INDEX "payslip_lines_instalment_per_payslip" ON "payslip_lines" ("repayment_agreement_id","repayment_sequence","payslip_id") WHERE "repayment_agreement_id" IS NOT NULL;
