import { Effect } from 'effect';
import type { LeaveContext } from '../../src/lib/leave/context.ts';
import { planLeaveActivity, type LeaveSubmission } from '../../src/lib/leave/activity.ts';
import type { LeaveActivity } from '../../src/lib/leave/pending.ts';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const annualWindow = { start: '2026-01-01', end: '2026-12-31' };
const span = { start: '2025-01-01', end: null };

/** Approved contract facts and a published calendar, with no materialised annual balance. */
export function leaveContext(): LeaveContext {
	return {
		employments: [
			{
				id: id(1),
				employee_id: id(2),
				company_id: id(3),
				effective_range: span
			}
		],
		companies: [{ id: id(3), settings_code: 'TEST', region: null }],
		employees: [
			{
				id: id(2),
				gender: 'FEMALE',
				date_of_birth: '1992-01-04',
				nationality: 'MY',
				marital_status: 'SINGLE',
				solo_parent: false,
				race: null,
				religion: null,
				children: []
			}
		],
		terms: [
			{
				id: id(4),
				employment_id: id(1),
				effective_range: span,
				agreed_days_per_week: 7,
				shift_pattern_id: id(5),
				employment_type: 'PERMANENT',
				residency_status: null,
				work_classification: 'EA_COVERED',
				base_salary: { value: 3000, currency: 'MYR' },
				statutory_work_category: 'NON_MANUAL',
				department: null,
				payroll_group: null,
				grade: null,
				residency_since: null
			}
		],
		entries: [],
		workDays: [],
		runs: [],
		payslips: [],
		versions: [
			{
				id: id(6),
				code: 'TEST',
				payroll: {
					currency: 'MYR',
					timezone: 'Asia/Kuala_Lumpur',
					tax_year_start_month: 1,
					allowance_npl_prorates: false
				},
				jurisdiction_code: 'TEST-JUR',
				sealed_at: span.start,
				voided_at: null,
				effective_range: span,
				approval_id: null
			}
		],
		catalogues: [
			{
				id: id(7),
				settings_id: id(6),
				code: 'ANNUAL',
				name: 'Annual leave',
				is_npl: false,
				can_encash: true,
				encash_on_exit: true,
				evidence_after_days: null,
				eligibility: '',
				entitlement: {
					availability: 'UPFRONT',
					proration: 'NONE',
					year_start_month: 1,
					bands: [{ eligibility: '', days: 12 }]
				}
			}
		],
		holidays: [],
		patterns: [
			{
				id: id(5),
				code: 'EVERY-DAY',
				effective_range: span,
				pattern: { days: [{ roster_code_id: id(8) }] }
			}
		],
		shifts: [
			{
				id: id(8),
				company_id: id(3),
				effective_range: span,
				variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
			}
		]
	};
}

export const timeOff = (
	from: string,
	to = from
): Omit<LeaveSubmission, 'employment_id' | 'catalogue_id' | 'reference'> => ({
	from_date: from,
	to_date: to,
	half_day_start: false,
	half_day_end: false,
	days: null,
	as_adjustment_entry: false,
	reason: null
});
export const submission = (
	fields: Omit<LeaveSubmission, 'employment_id' | 'catalogue_id' | 'reference'>,
	reference = 'TEST'
): LeaveSubmission => ({
	employment_id: id(1),
	catalogue_id: id(7),
	reference,
	...fields
});
/** The pattern and roster-code reads a terms transform makes, as the runtime's `db` answers them. */
export function scheduleDb() {
	const { patterns, shifts } = leaveContext();
	return {
		shift_patterns: { findMany: () => Effect.succeed(patterns) },
		shift_definitions: { findMany: () => Effect.succeed(shifts) }
	};
}

export function approve(
	context: LeaveContext,
	fields: Omit<LeaveSubmission, 'employment_id' | 'catalogue_id' | 'reference'>,
	number = 10
): LeaveActivity {
	const plan = planLeaveActivity(context, submission(fields, `TEST-${number}`), id(number));
	const row: LeaveActivity = { ...plan, id: id(number), approval_id: null };
	context.entries.push(row);
	return row;
}

export { planLeaveBatch } from '../../src/lib/leave/plan-batch.ts';
