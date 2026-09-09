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
				hire_date: span.start,
				exit_date: null,
				children: []
			}
		],
		companies: [{ id: id(3), settings_code: 'TEST' }],
		employees: [
			{
				id: id(2),
				gender: 'FEMALE',
				date_of_birth: '1992-01-04',
				nationality: 'MY'
			}
		],
		terms: [
			{
				id: id(4),
				employment_id: id(1),
				effective_range: span,
				shift_pattern_id: id(5),
				employment_type: 'PERMANENT',
				residency_status: null,
				work_classification: 'EA_COVERED',
				base_salary: { value: 3000, currency: 'MYR' },
				statutory_work_category: 'NON_MANUAL',
				department: null,
				payroll_group: null
			}
		],
		entries: [],
		workDays: [],
		runs: [],
		captures: [],
		payslips: [],
		versions: [
			{
				id: id(6),
				code: 'TEST',
				currency: 'MYR',
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
				is_statutory: false,
				payroll_effect: { kind: 'PAID' },
				encashment: { code: 'LEAVE_CASH', sequence: 10, contribution_treatments: {} },
				eligibility: '',
				requires_certificate_after_days: null,
				entitlement: {
					availability: 'UPFRONT',
					proration: 'NONE',
					year_start_month: 1,
					bands: [{ band_from: 0, days: 12 }]
				}
			}
		],
		holidays: [],
		patterns: [
			{
				id: id(5),
				code: 'EVERY-DAY',
				effective_range: span,
				pattern: {
					type: 'PATTERNED',
					anchor_date: span.start,
					phases: [{ duration: { kind: 'CONTINUOUS' }, day_cycle: [{ roster_code_id: id(8) }] }]
				}
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

export const timeOff = (from: string, to = from): LeaveSubmission['event'] => ({
	kind: 'TIME_OFF',
	range: { start: { date: from, half: 'FIRST' }, end: { date: to, half: 'SECOND' } },
	chargeable_days: null,
	reason: null
});
export const submission = (
	event: LeaveSubmission['event'],
	reference = 'TEST'
): LeaveSubmission => ({
	employment_id: id(1),
	leave_catalogue_id: id(7),
	reference,
	event
});
export function approve(
	context: LeaveContext,
	event: LeaveSubmission['event'],
	number = 10
): LeaveActivity {
	const plan = planLeaveActivity(context, submission(event, `TEST-${number}`), id(number));
	const row: LeaveActivity = { ...plan, id: id(number), approval_id: null };
	context.entries.push(row);
	return row;
}

export { default as leaveEntryHooks } from '../../src/collections/leave_entries/+hooks.ts';
