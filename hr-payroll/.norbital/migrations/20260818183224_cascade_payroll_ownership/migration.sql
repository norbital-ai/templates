ALTER TABLE "company_holidays" DROP CONSTRAINT "company_holidays_company_id_companies_fk", ADD CONSTRAINT "company_holidays_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "contribution_rates" DROP CONSTRAINT "contribution_rates_statutory_contribution_id_statutory_contributions_fk", ADD CONSTRAINT "contribution_rates_statutory_contribution_id_statutory_contributions_fk" FOREIGN KEY ("statutory_contribution_id") REFERENCES "statutory_contributions"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" DROP CONSTRAINT "employment_statutory_facts_employment_id_employments_fk", ADD CONSTRAINT "employment_statutory_facts_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "employment_terms" DROP CONSTRAINT "employment_terms_employment_id_employments_fk", ADD CONSTRAINT "employment_terms_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payroll_settlements" DROP CONSTRAINT "payroll_settlements_payroll_run_id_payroll_runs_fk", ADD CONSTRAINT "payroll_settlements_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_lines" DROP CONSTRAINT "payslip_lines_payslip_id_payslips_fk", ADD CONSTRAINT "payslip_lines_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk", ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "roster_entries" DROP CONSTRAINT "roster_entries_roster_id_rosters_fk", ADD CONSTRAINT "roster_entries_roster_id_rosters_fk" FOREIGN KEY ("roster_id") REFERENCES "rosters"("norbital_id") ON DELETE CASCADE;
