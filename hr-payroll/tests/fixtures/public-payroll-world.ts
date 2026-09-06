// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Public one-person payroll world.
 * Gather, the create hook and the unique-index persist test all share this fixture.
 */
import type { PayrollWorld } from './memory-payroll-api.ts';

export const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
export const JURISDICTION_ID = '22222222-2222-4222-8222-222222222222';
export const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
export const EMPLOYMENT_ID = '44444444-4444-4444-8444-444444444444';
export const TERMS_ID = '55555555-5555-4555-8555-555555555555';
export const BASIC_ID = '66666666-6666-4666-8666-666666666666';
export const TRANSPORT_ID = '77777777-7777-4777-8777-777777777777';
export const STANDING_ENTRY_ID = '88888888-8888-4888-8888-888888888888';
export const BONUS_ENTRY_ID = '99999999-9999-4999-8999-999999999999';
export const DEFAULT_LEAVE_PLAN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const RANGE = { start: '2020-01-01', end: null };
const ROSTERED = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 6,
		required_paid_minutes: 2700
	}
};

const WORK_SHIFT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

/**
 * Plan-only roster rows covering both payroll attendance windows the tests build
 * (2025-12-21→2026-01-20 and 2026-01-21→2026-02-20). A rostered employment has no
 * pattern day, so its guaranteed load is validated at precheck over the pay window;
 * with no rows the run is refused. `worked_intervals: null` carries no attendance,
 * so these rows satisfy the roster check without capturing work days or moving money.
 */
function rosteredWorkDays(): PayrollWorld['work_days'] {
	const rows: PayrollWorld['work_days'] = [];
	let date = '2025-12-21';
	const end = '2026-02-20';
	while (date <= end) {
		rows.push({
			id: `work-day-${date}`,
			employment_id: EMPLOYMENT_ID,
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

const REGIME = {
	overtime_coverage: null,
	overtime_rules: [],
	overtime_limits: []
};

const STATUTORY_LEAVE = [
	{
		kind: 'ANNUAL',
		ladder: [{ band_from: 0, days: 8 }],
		per_child: null,
		max_days: null,
		transition: 'NEXT_LEAVE_YEAR',
		settlement: { settlement: 'FORFEIT' },
		authority: 'Public fixture — not a sealed statutory table.'
	}
];

export type PublicPayrollWorldOptions = {
	/** When true, a one-off BONUS sits beside the standing allowance. */
	readonly includeBonus?: boolean;
};

export function createPublicPayrollWorld(options: PublicPayrollWorldOptions = {}): PayrollWorld {
	const standing = {
		id: STANDING_ENTRY_ID,
		employment_id: EMPLOYMENT_ID,
		pay_component_id: TRANSPORT_ID,
		amount: 310,
		quantity: null,
		event_date: '2026-01-01',
		pay_period: null,
		effective_range: { start: '2026-01-01', end: '2026-03-31' },
		event: { kind: 'ALLOWANCE' },
		corrects_adjustment_id: null,
		evidence_file: null,
		approval_id: null
	};
	const bonus = {
		id: BONUS_ENTRY_ID,
		employment_id: EMPLOYMENT_ID,
		pay_component_id: TRANSPORT_ID,
		amount: 100,
		quantity: null,
		event_date: '2026-01-15',
		pay_period: '2026-01',
		effective_range: null,
		event: { kind: 'BONUS', note: 'one-off' },
		corrects_adjustment_id: null,
		evidence_file: null,
		approval_id: null
	};
	return {
		companies: [
			{
				id: COMPANY_ID,
				jurisdiction_id: JURISDICTION_ID,
				name: 'Public Fixture Co',
				registration_number: 'PF-0001',
				pay_cutoff_day: 21,
				pay_day: 28,
				pay_calendar: null,
				leave_year_start_month: 1,
				overtime_calculation_method: 'STATUTORY_AGGREGATE',
				settlement_policy: null,
				risk_class: null,
				effective_range: RANGE,
				approval_id: null
			}
		],
		jurisdictions: [
			{
				id: JURISDICTION_ID,
				code: 'PF',
				name: 'Public fixture profile',
				lifecycle: 'SEALED',
				currency: 'MYR',
				tax_year_start_month: 1,
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate_basis: 'DAYS_PER_MONTH',
				ordinary_rate_divisor: 26,
				regime: REGIME,
				statutory_leave: STATUTORY_LEAVE,
				successor_profile_id: null,
				void_reason: null,
				effective_range: RANGE,
				approval_id: null
			}
		],
		statutory_contributions: [],
		contribution_rates: [],
		pay_components: [
			{
				id: BASIC_ID,
				company_id: COMPANY_ID,
				statutory_profile_id: JURISDICTION_ID,
				code: 'BASIC',
				name: 'Basic salary',
				nature: 'EARNING',
				policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
				sequence: 10,
				eligibility: [],
				definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false },
				approval_id: null
			},
			{
				id: TRANSPORT_ID,
				company_id: COMPANY_ID,
				statutory_profile_id: JURISDICTION_ID,
				code: 'TRANSPORT',
				name: 'Transport allowance',
				nature: 'EARNING',
				policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
				sequence: 50,
				eligibility: [],
				definition: {
					source: 'ENTRY',
					unit: 'MONEY',
					evidence: 'NONE',
					cap: null,
					settlement: 'PAYROLL'
				},
				approval_id: null
			}
		],
		shift_definitions: [
			{
				id: WORK_SHIFT_ID,
				company_id: COMPANY_ID,
				code: '7.5AM',
				name: 'Day',
				variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 },
				effective_range: RANGE,
				approval_id: null
			}
		],
		company_holidays: [],
		leave_plans: [
			{
				id: DEFAULT_LEAVE_PLAN_ID,
				company_id: COMPANY_ID,
				code: 'DEFAULT',
				name: 'Public fixture leave plan',
				lifecycle: 'ACTIVE',
				transition: 'NEXT_LEAVE_YEAR',
				effective_range: RANGE,
				supersedes_id: null,
				change_note: 'Stable payroll fixture baseline',
				approval_id: null
			}
		],
		leave_types: [],
		leave_accounts: [],
		leave_entries: [],
		employments: [
			{
				id: EMPLOYMENT_ID,
				employee_id: EMPLOYEE_ID,
				company_id: COMPANY_ID,
				employee_number: 'PF0001',
				hire_date: '2021-06-01',
				exit_date: null,
				exit_reason: null,
				bank: null,
				effective_range: { start: '2021-06-01', end: null },
				approval_id: null
			}
		],
		employees: [
			{
				id: EMPLOYEE_ID,
				name: 'Public Fixture Employee',
				date_of_birth: '1992-01-04',
				gender: 'FEMALE',
				marital_status: 'SINGLE',
				spouse_status: 'NONE',
				dependents_count: 0,
				approval_id: null
			}
		],
		employment_terms: [
			{
				id: TERMS_ID,
				employment_id: EMPLOYMENT_ID,
				base_salary: { value: 3451, currency: 'MYR' },
				pay_frequency: 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				department: null,
				job_title: 'Clerk',
				payroll_group: null,
				work_pattern: ROSTERED,
				effective_range: { start: '2021-06-01', end: null },
				approval_id: null
			}
		],
		employment_statutory_facts: [],
		component_entries: options.includeBonus === true ? [standing, bonus] : [standing],
		loans: [],
		loan_repayments: [],
		leave_requests: [],
		work_days: rosteredWorkDays(),
		employee_children: [],
		payroll_runs: [],
		payslips: [],
		payslip_component_entry_inputs: [],
		payslip_adjustments: [],
		payslip_leave_request_inputs: [],
		payslip_loan_repayment_inputs: []
	};
}
