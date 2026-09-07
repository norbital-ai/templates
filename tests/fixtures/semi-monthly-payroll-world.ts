// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A company that pays twice a month, holding one employment on each cadence.
 *
 * The public world is a monthly-only entity. This one is the shape Omni Plus PH has: the company's
 * `pay_frequency` is `SEMI_MONTHLY`, one employment is on `SEMI_MONTHLY` terms and one stays
 * monthly on the cutoff window. A percentage retirement scheme sits on both cadences so a net is
 * more than a base wage, and so the two halves of a month have a contribution to add up.
 */
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	createPublicPayrollWorld
} from './public-payroll-world.ts';
import type { PayrollWorld } from './memory-payroll-api.ts';

export { COMPANY_ID, JURISDICTION_ID, EMPLOYMENT_ID as MONTHLY_EMPLOYMENT_ID };

export const SEMI_MONTHLY_EMPLOYEE_ID = '33333333-3333-4333-8333-333333333334';
export const SEMI_MONTHLY_EMPLOYMENT_ID = '44444444-4444-4444-8444-444444444445';
export const SEMI_MONTHLY_TERMS_ID = '55555555-5555-4555-8555-555555555556';
export const RETIREMENT_SCHEME_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa1';

/** The semi-monthly contract wage: a month's pay, whatever the cadence it is paid on. */
export const SEMI_MONTHLY_BASE = 4100;

const WORK_SHIFT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

/** Plan-only roster rows for the semi-monthly employment from the December cutoff to the end of February. */
function rosteredWorkDays(employmentId: string, start: string, end: string) {
	const rows: PayrollWorld['work_days'] = [];
	let date = start;
	while (date <= end) {
		rows.push({
			id: `work-day-${employmentId}-${date}`,
			employment_id: employmentId,
			work_date: date,
			shift_definition_id: WORK_SHIFT_ID,
			worked_intervals: null,
			break_minutes: null,
			approval_id: null
		});
		date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
	}
	return rows;
}

export function createSemiMonthlyPayrollWorld(): PayrollWorld {
	const world = createPublicPayrollWorld();
	world.companies[0].pay_frequency = 'SEMI_MONTHLY';
	world.statutory_contributions.push({
		id: RETIREMENT_SCHEME_ID,
		settings_id: JURISDICTION_ID,
		is_statutory: true,
		code: 'PUB-EPF',
		name: 'Public fixture retirement fund',
		authority: 'Public fixture',
		payer: 'BOTH',
		keyed_by: 'WAGE',
		rounding: 'NEAREST_CENT',
		relief_for: [],
		sequence: 1,
		special_rules: [],
		approval_id: null
	});
	world.contribution_rates.push({
		id: 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa2',
		statutory_contribution_id: RETIREMENT_SCHEME_ID,
		selector: { by: 'WAGE', from: 0, to: null },
		award: { kind: 'PERCENT', employee: 11, employer: 13 },
		approval_id: null
	});
	for (const component of world.pay_components)
		component.contribution_treatments = { 'PUB-EPF': { kind: 'INCLUDE' } };
	world.employees.push({
		id: SEMI_MONTHLY_EMPLOYEE_ID,
		name: 'Semi-monthly Fixture Employee',
		date_of_birth: '1990-05-20',
		gender: 'MALE',
		marital_status: 'SINGLE',
		spouse_status: 'NONE',
		dependents_count: 0,
		approval_id: null
	});
	world.employments.push({
		id: SEMI_MONTHLY_EMPLOYMENT_ID,
		employee_id: SEMI_MONTHLY_EMPLOYEE_ID,
		company_id: COMPANY_ID,
		employee_number: 'PF0002',
		hire_date: '2022-03-01',
		exit_date: null,
		exit_reason: null,
		bank: null,
		effective_range: { start: '2022-03-01', end: null },
		approval_id: null
	});
	world.employment_terms.push({
		...structuredClone(world.employment_terms[0]),
		id: SEMI_MONTHLY_TERMS_ID,
		employment_id: SEMI_MONTHLY_EMPLOYMENT_ID,
		base_salary: { value: SEMI_MONTHLY_BASE, currency: 'MYR' },
		pay_frequency: 'SEMI_MONTHLY',
		job_title: 'Operator',
		effective_range: { start: '2022-03-01', end: null }
	});
	world.work_days.push(...rosteredWorkDays(SEMI_MONTHLY_EMPLOYMENT_ID, '2025-12-21', '2026-02-28'));
	return world;
}
