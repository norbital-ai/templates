import type { CollectionName, ReadField } from '@norbital-ai/bolt';
import adhoc_catalogue from '../data/model/adhoc_catalogue/+model.ts';
import adhoc_requests from '../data/model/adhoc_requests/+model.ts';
import allowance_catalogue from '../data/model/allowance_catalogue/+model.ts';
import benefit_case_cutoffs from '../data/model/benefit_case_cutoffs/+model.ts';
import benefit_case_movements from '../data/model/benefit_case_movements/+model.ts';
import benefit_case_plans from '../data/model/benefit_case_plans/+model.ts';
import benefit_cases from '../data/model/benefit_cases/+model.ts';
import claim_catalogue from '../data/model/claim_catalogue/+model.ts';
import claim_requests from '../data/model/claim_requests/+model.ts';
import companies from '../data/model/companies/+model.ts';
import company_facts from '../data/model/company_facts/+model.ts';
import contribution_statement_months from '../data/model/contribution_statement_months/+model.ts';
import employees from '../data/model/employees/+model.ts';
import employment_statutory_facts from '../data/model/employment_statutory_facts/+model.ts';
import employment_terms from '../data/model/employment_terms/+model.ts';
import employment_wage_periods from '../data/model/employment_wage_periods/+model.ts';
import employments from '../data/model/employments/+model.ts';
import fact_evidence from '../data/model/fact_evidence/+model.ts';
import jurisdiction_holidays from '../data/model/jurisdiction_holidays/+model.ts';
import jurisdiction_settings from '../data/model/jurisdiction_settings/+model.ts';
import leave_catalogue from '../data/model/leave_catalogue/+model.ts';
import leave_entries from '../data/model/leave_entries/+model.ts';
import loan_catalogue from '../data/model/loan_catalogue/+model.ts';
import loan_repayments from '../data/model/loan_repayments/+model.ts';
import loans from '../data/model/loans/+model.ts';
import noncontract_settlements from '../data/model/noncontract_settlements/+model.ts';
import payable_tranches from '../data/model/payable_tranches/+model.ts';
import payment_allocations from '../data/model/payment_allocations/+model.ts';
import payment_events from '../data/model/payment_events/+model.ts';
import payment_holds from '../data/model/payment_holds/+model.ts';
import payroll_runs from '../data/model/payroll_runs/+model.ts';
import payslip_wage_periods from '../data/model/payslip_wage_periods/+model.ts';
import payslips from '../data/model/payslips/+model.ts';
import presence_periods from '../data/model/presence_periods/+model.ts';
import rosters from '../data/model/rosters/+model.ts';
import shift_definitions from '../data/model/shift_definitions/+model.ts';
import shift_patterns from '../data/model/shift_patterns/+model.ts';
import statutory_contributions from '../data/model/statutory_contributions/+model.ts';
import work_days from '../data/model/work_days/+model.ts';
import relationships from '../data/+relationship.ts';

type Declared = { readonly fields: object; readonly computed?: object };
/** Every model: a whole-row read names any of them. */
const MODELS: { readonly [collection: string]: Declared } = {
	adhoc_catalogue,
	adhoc_requests,
	allowance_catalogue,
	benefit_case_cutoffs,
	benefit_case_movements,
	benefit_case_plans,
	benefit_cases,
	claim_catalogue,
	claim_requests,
	companies,
	company_facts,
	contribution_statement_months,
	employees,
	employment_statutory_facts,
	employment_terms,
	employment_wage_periods,
	employments,
	fact_evidence,
	jurisdiction_holidays,
	jurisdiction_settings,
	leave_catalogue,
	leave_entries,
	loan_catalogue,
	loan_repayments,
	loans,
	noncontract_settlements,
	payable_tranches,
	payment_allocations,
	payment_events,
	payment_holds,
	payroll_runs,
	payslip_wage_periods,
	payslips,
	presence_periods,
	rosters,
	shift_definitions,
	shift_patterns,
	statutory_contributions,
	work_days
};
const SYSTEM = ['revision', 'approval_id', 'created_at', 'updated_at', 'created_by', 'updated_by'];

/**
 * Every field of a collection as a `select`. A read's default projection omits `json` and `custom` values (RFC X-33),
 * and these readers use them (a pattern's days, a shift's window, the settings' rules), so they name the whole row.
 */
export function everyField<C extends CollectionName>(
	collection: C
): { readonly [P in ReadField<C>]: true } {
	const model = MODELS[collection];
	if (model == null) throw new Error(`everyField: no model '${collection}'`);
	const fks = Object.keys(relationships)
		.filter((key) => key.startsWith(`${collection}.`))
		.map((key) => key.slice(collection.length + 1));
	return Object.fromEntries(
		[...SYSTEM, ...Object.keys(model.fields), ...Object.keys(model.computed ?? {}), ...fks].map(
			(field) => [field, true] as const
		)
	) as { readonly [P in ReadField<C>]: true };
}
