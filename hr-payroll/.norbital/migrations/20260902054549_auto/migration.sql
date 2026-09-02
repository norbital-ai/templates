DROP INDEX "payslip_component_entry_inputs_component_entry_id_idx";
--> statement-breakpoint
DROP INDEX "payslip_leave_request_inputs_leave_request_id_idx";
--> statement-breakpoint
DROP INDEX "payslip_loan_repayment_inputs_loan_repayment_id_idx";
--> statement-breakpoint
DROP INDEX "payslip_work_day_inputs_work_day_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_component_entry_inputs_component_entry_id_index" ON "payslip_component_entry_inputs" ("component_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_leave_request_inputs_leave_request_id_index" ON "payslip_leave_request_inputs" ("leave_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_loan_repayment_inputs_loan_repayment_id_index" ON "payslip_loan_repayment_inputs" ("loan_repayment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_work_day_inputs_work_day_id_index" ON "payslip_work_day_inputs" ("work_day_id");
