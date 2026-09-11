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
/** The one named pattern the public terms point at: a rostered weekly guarantee. */
export const SHIFT_PATTERN_ID = '99999999-9999-4999-8999-999999999901';
export const BASIC_ID = '66666666-6666-4666-8666-666666666666';
export const TRANSPORT_ID = '77777777-7777-4777-8777-777777777777';
export const TRANSPORT_PAYMENT_ID = '77777777-7777-4777-8777-777777777778';
export const STANDING_ENTRY_ID = '88888888-8888-4888-8888-888888888888';
export const PAYMENT_ENTRY_ID = '99999999-9999-4999-8999-999999999999';

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
	holiday_rest_precedence: 'REST_DAY',
	overtime_coverage: null,
	overtime_rules: [],
	overtime_limits: []
};

export type PublicPayrollWorldOptions = {
	/** When true, a one-off PAYMENT sits beside the standing allowance. */
	readonly includePayment?: boolean;
};

export function createPublicPayrollWorld(options: PublicPayrollWorldOptions = {}): PayrollWorld {
	const standing = {
		id: STANDING_ENTRY_ID,
		employment_id: EMPLOYMENT_ID,
		allowance_catalogue_id: TRANSPORT_ID,
		amount: 310,
		pay_period: null,
		// A standing allowance: its window is the recurrence itself, and it pays whole in every
		// period the window covers rather than depleting across them. There is no date column here
		// on purpose — the window already states the day it opens.
		recurrence: { kind: 'RECURRING', from: '2026-01-01', to: '2026-03-31' },
		approval_id: null
	};
	const payment = {
		id: PAYMENT_ENTRY_ID,
		employment_id: EMPLOYMENT_ID,
		payment_catalogue_id: TRANSPORT_PAYMENT_ID,
		amount: 100,
		effective_on: '2026-01-15',
		pay_period: '2026-01',
		reason: 'one-off',
		approval_id: null
	};
	return {
		companies: [
			{
				id: COMPANY_ID,
				settings_code: 'PF',
				jurisdiction_code: 'TEST-JUR',
				name: 'Public Fixture Co',
				registration_number: 'PF-0001',
				pay_cutoff_day: 21,
				risk_class: null,
				effective_range: RANGE,
				approval_id: null
			}
		],
		jurisdiction_settings: [
			{
				id: JURISDICTION_ID,
				code: 'PF',
				jurisdiction_code: 'TEST-JUR',
				name: 'Public fixture profile',
				sealed_at: '2020-01-01T00:00:00.000Z',
				voided_at: null,
				void_reason: null,
				cloned_from_id: null,
				currency: 'MYR',
				tax_year_start_month: 1,
				effective_range: RANGE,
				approval_id: null
			}
		],
		statutory_contributions: [],
		work_catalogue: [
			{
				id: BASIC_ID,
				settings_id: JURISDICTION_ID,
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }],
				regime: REGIME,
				treatments: {},
				authority: null,
				approval_id: null
			}
		],

		/**
		 * One code, two catalogues, two rows. A standing transport allowance and a one-off transport
		 * payment are different events with different shapes, and after the split they cannot share a
		 * catalogue row — the foreign key each request carries points at a different table. The code
		 * is the same because the payslip line is the same thing to the person reading it.
		 */
		claim_catalogue: [],
		allowance_catalogue: [
			{
				id: TRANSPORT_ID,
				settings_id: JURISDICTION_ID,
				code: 'TRANSPORT',
				name: 'Transport allowance',
				nature: 'EARNING',
				contribution_treatments: {},
				sequence: 50,
				eligibility: '',
				evidence: 'NONE',
				settlement: 'PAYROLL',
				cap: null,
				approval_id: null
			}
		],
		payment_catalogue: [
			{
				id: TRANSPORT_PAYMENT_ID,
				settings_id: JURISDICTION_ID,
				code: 'TRANSPORT',
				name: 'Transport allowance',
				nature: 'EARNING',
				contribution_treatments: {},
				sequence: 51,
				eligibility: '',
				evidence: 'NONE',
				settlement: 'PAYROLL',
				cap: null,
				approval_id: null
			}
		],
		loan_catalogue: [],
		shift_definitions: [
			{
				id: WORK_SHIFT_ID,
				settings_code: 'PF',
				code: '7.5AM',
				name: 'Day',
				variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 },
				effective_range: RANGE,
				approval_id: null
			}
		],
		shift_patterns: [
			{
				id: SHIFT_PATTERN_ID,
				settings_code: 'PF',
				code: 'ROSTER-6D-45H-WK',
				name: 'Rostered, 6 days and 45 hours guaranteed per week',
				pattern: ROSTERED,
				effective_range: RANGE,
				approval_id: null
			}
		],
		// Published holidays only exist where a test declares one; a year with none is a year with none.
		jurisdiction_holidays: [],
		leave_catalogue: [],
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
				children: [],
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
				shift_pattern_id: SHIFT_PATTERN_ID,
				effective_range: { start: '2021-06-01', end: null },
				approval_id: null
			}
		],
		employment_statutory_facts: [],
		claim_requests: [],
		allowance_requests: [standing],
		payment_requests: options.includePayment === true ? [payment] : [],
		loans: [],
		loan_repayments: [],
		work_days: rosteredWorkDays(),
		payroll_runs: [],
		payslips: [],
		payslip_allowance_request_inputs: [],
		payslip_leave_inputs: [],
		payslip_loan_repayment_inputs: []
	};
}
