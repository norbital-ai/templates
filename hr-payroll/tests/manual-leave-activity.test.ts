import assert from 'node:assert/strict';
import test from 'node:test';
import { planLeaveActivity, type LeaveSubmission } from '../src/lib/leave/activity.ts';
import { leaveRules, type LeaveContext } from '../src/lib/leave/context.ts';
import { evaluateLeavePreview } from '../src/lib/leave/preview.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { leaveBalanceAt } from '../src/lib/leave/balance.ts';
import { leavePayrollInputs } from '../src/lib/leave/payroll.ts';
import type { LeaveActivity } from '../src/lib/leave/pending.ts';

type LeaveFields = Omit<LeaveSubmission, 'employment_id' | 'catalogue_id' | 'reference'>;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = { start: '2026-01-01', end: '2026-12-31' };
const next = { start: '2027-01-01', end: '2027-12-31' };
const span = { start: '2025-01-01', end: null };
function facts(): LeaveContext {
	return {
		employments: [
			{
				id: id(1),
				employee_id: id(2),
				company_id: id(3),
				effective_range: { start: '2025-01-01', end: null }
			}
		],
		companies: [{ id: id(3), settings_code: 'TEST' }],
		employees: [{ id: id(2), gender: null, date_of_birth: null, nationality: null, children: [] }],
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
				sealed_at: '2025-01-01',
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
				evidence: 'NONE',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				eligibility: '',
				entitlement: {
					availability: 'UPFRONT',
					proration: 'NONE',
					year_start_month: 1,
					bands: [{ eligibility: '', days: 12 }]
				},
				evidence_after_days: null
			}
		],
		holidays: [],
		workDays: [],
		runs: [],
		captures: [],
		payslips: [],
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
const submission = (fields: LeaveFields, reference = 'test'): LeaveSubmission => ({
	employment_id: id(1),
	catalogue_id: id(7),
	reference,
	...fields
});
function approve(context: LeaveContext, fields: LeaveFields, number = 10): LeaveActivity {
	const planned = planLeaveActivity(context, submission(fields, String(number)), id(number));
	const row: LeaveActivity = { ...planned, id: id(number), approval_id: null };
	context.entries.push(row);
	return row;
}
const cash = (days = 3): LeaveFields => ({
	from_date: window.start,
	to_date: window.end,
	days,
	encash_days: days,
	effective_on: '2026-08-01',
	due_on: '2026-09-01',
	reason: 'Agreed departure payment'
});
const carry = (): LeaveFields => ({
	from_date: window.start,
	to_date: window.end,
	destination_from: next.start,
	destination_to: next.end,
	days: 5,
	available_from: next.start,
	expires_on: '2027-03-31',
	effective_on: '2027-01-15',
	reason: 'Approved transfer'
});
const timeOff = (from: string, to = from): LeaveFields => ({
	from_date: from,
	to_date: to,
	half_day_start: false,
	half_day_end: false,
	days: null,
	reason: null
});
const reversal = (original: LeaveActivity): LeaveFields => ({
	as_adjustment_entry: true,
	reversal_of_id: original.id,
	effective_on: '2027-04-01',
	due_on: '2027-04-30',
	days: null,
	reason: 'Correction'
});

test('a collapsed cross-month range retains half-day charges, holiday evidence and per-period consumption', () => {
	const context = facts();
	context.holidays.push({
		id: id(2026),
		company_id: '00000000-0000-4000-8000-000000000003',
		date: '2026-01-31',
		name: 'Test holiday',
		replaces: null,
		published_at: '2025-01-01T00:00:00.000Z'
	});
	// A time-off entry settles whole in one period, so the collapsed range is two entries — one per
	// period — and each keeps its exact half-day charges and holiday evidence.
	const january = approve(
		context,
		{
			from_date: '2026-01-30',
			to_date: '2026-01-30',
			half_day_start: true,
			half_day_end: false,
			days: null,
			reason: null
		},
		101
	);
	const february = approve(
		context,
		{
			from_date: '2026-02-01',
			to_date: '2026-02-02',
			half_day_start: false,
			half_day_end: true,
			days: null,
			reason: null
		},
		102
	);
	assert.deepEqual(
		january.charges.map((charge) => [charge.date, charge.days]),
		[['2026-01-30', 0.5]]
	);
	assert.deepEqual(
		february.charges.map((charge) => [charge.date, charge.days]),
		[
			['2026-02-01', 1],
			['2026-02-02', 0.5]
		]
	);
	assert.equal(january.days, 0.5);
	assert.equal(february.days, 1.5);
	const row = january;
	const jan = leavePayrollInputs({
		entries: context.entries,
		salaryWindow: { start: '2026-01-01', end: '2026-01-31' },
		dueThrough: '2026-01-31',
		captures: []
	});
	const feb = leavePayrollInputs({
		entries: context.entries,
		salaryWindow: { start: '2026-02-01', end: '2026-02-28' },
		dueThrough: '2026-02-28',
		captures: []
	});
	assert.equal(
		jan.timeOff[0]!.charges.reduce((sum, c) => sum + c.days, 0),
		0.5
	);
	assert.equal(
		feb.timeOff[0]!.charges.reduce((sum, c) => sum + c.days, 0),
		1.5
	);
	assert.equal(
		leavePayrollInputs({
			entries: context.entries,
			salaryWindow: { start: '2026-01-01', end: '2026-02-28' },
			dueThrough: '2026-02-28',
			captures: [
				{
					leave_entry_id: row.id,
					charges: jan.timeOff[0]!.charges,
					gross_amount: { value: 0, currency: 'MYR' }
				}
			]
		}).timeOff[0]!.charges.length,
		2
	);
});

test('opposite half-days can be approved separately, but overlapping or duplicate activity refuses', () => {
	const context = facts();
	approve(context, {
		from_date: '2026-02-01',
		to_date: '2026-02-01',
		half_day_start: false,
		half_day_end: true,
		days: null,
		reason: null
	});
	assert.doesNotThrow(() =>
		approve(
			context,
			{
				from_date: '2026-02-01',
				to_date: '2026-02-01',
				half_day_start: true,
				half_day_end: false,
				days: null,
				reason: null
			},
			11
		)
	);
	assert.throws(() => approve(context, timeOff('2026-02-01'), 12), /overlaps/);
	assert.throws(() => approve(context, timeOff('2026-03-01'), 10), /reference already/);
});

test('ended employment retains manual encashment, agreed amounts and later settlement eligibility', () => {
	const context = facts();
	context.employments[0]!.effective_range = { start: '2025-01-01', end: '2026-06-30' };
	context.catalogues[0]!.entitlement = {
		...context.catalogues[0]!.entitlement,
		proration: 'CALENDAR_MONTHS'
	};
	assert.equal(context.entries.length, 0);
	const row = approve(context, cash());
	assert.equal(row.allocations[0]!.date, '2026-06-30');
	assert.equal(row.allocations[0]!.days, -3);
	assert.throws(() => approve(context, cash(4), 11), /Insufficient leave/);
	assert.equal(
		leavePayrollInputs({
			entries: context.entries,
			salaryWindow: { start: '2026-08-01', end: '2026-08-31' },
			dueThrough: '2026-08-31',
			captures: []
		}).monetary.length,
		0
	);
	const due = leavePayrollInputs({
		entries: context.entries,
		salaryWindow: { start: '2026-10-01', end: '2026-10-31' },
		dueThrough: '2026-10-31',
		captures: []
	});
	// Leave carries no keyed money: the entry is selected with its days, and payroll prices them
	// at the ordinary day wage when it settles.
	assert.equal(due.monetary[0]!.entry.encash_days, 3);
});

test('a manually approved carry is available without a year job, and spent carry cannot be reversed', () => {
	const context = facts();
	const original = approve(context, carry());
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: next,
			date: next.start,
			entitlementAt: rules.entitlementAt
		}).balance,
		17
	);
	const taken = approve(context, timeOff('2027-02-01'), 11);
	assert.equal(taken.allocations[0]!.credit_entry_id, original.id);
	assert.throws(() => approve(context, reversal(original), 12), /overdrawn/);
});

test('reversal restores original credits and cancels an uncaptured monetary obligation', () => {
	const context = facts();
	const original = approve(context, cash());
	const correction = approve(context, reversal(original), 11);
	assert.equal(correction.as_adjustment_entry, true);
	assert.equal(correction.due_on, null, 'no captured money means no due date');
	assert.equal(correction.allocations[0]!.date, original.allocations[0]!.date);
	assert.equal(correction.allocations[0]!.days, 3);
	assert.equal(
		leavePayrollInputs({
			entries: context.entries,
			salaryWindow: window,
			dueThrough: '2028-01-01',
			captures: []
		}).monetary.length,
		0
	);
	assert.throws(() => approve(context, reversal(original), 12), /already reversed/);
});

test('a paid reversal negates the captured outputs exactly; a draft holding the source must be resolved first', () => {
	const context = facts();
	const original = approve(context, cash());
	context.payslips.push({
		id: id(21),
		payroll_run_id: id(20),
		status: 'DRAFT',
		paid_at: null,
		currency: 'MYR',
		// The settled lines are the frozen evidence now: a paid reversal negates them exactly.
		adjustments: [{ family: 'LEAVE', source_id: original.id, bucket: 'EARNING', amount: 150 }]
	});
	original.payslip_id = id(21);
	assert.throws(() => approve(context, reversal(original), 11), /draft payroll/);
	// Payment is the slip's fact, so this is what settles the capture — not its run's summary.
	const slip = context.payslips.find((row) => row.id === id(21))!;
	slip.paid_at = '2027-03-31';
	slip.status = 'PAID';
	const correction = approve(context, reversal(original), 11);
	assert.equal(correction.as_adjustment_entry, true);
	assert.equal(correction.due_on, '2027-04-30', 'a paid correction keeps its approved due date');
	const due = leavePayrollInputs({
		entries: context.entries,
		salaryWindow: { start: '2027-04-01', end: '2027-04-30' },
		dueThrough: '2027-04-30',
		captures: [{ leave_entry_id: original.id, paid: true }]
	});
	assert.equal(due.monetary.length, 1);
	assert.equal(due.monetary[0]!.entry.id, correction.id);
});

test('approval refuses paid date insertion', () => {
	const context = facts();
	context.runs.push({
		id: id(20),
		company_id: id(3),
		period: '2026-01',
		attendance_from: '2026-01-01',
		attendance_to: '2026-01-31'
	});
	// This person's own payslip is what closes the day: the run is only where it lives.
	context.payslips.push({
		id: id(22),
		payroll_run_id: id(20),
		employment_id: id(1),
		paid_at: '2026-01-31'
	});
	assert.throws(() => approve(context, timeOff('2026-01-01')), /PAID_PAYROLL/);
});

test('computed balance view reserves future time off, includes manual carry and excludes pending credits', () => {
	const context = facts();
	approve(context, carry(), 20);
	approve(context, timeOff('2027-02-01', '2027-02-02'), 21);
	const pending = planLeaveActivity(
		context,
		submission(timeOff('2027-02-03'), 'pending-debit'),
		id(22)
	);
	context.entries.push({ ...pending, id: id(22), approval_id: id(100) });
	const credit = planLeaveActivity(
		context,
		submission(
			{
				from_date: next.start,
				to_date: next.end,
				days: 10,
				effective_on: next.start,
				reason: 'Awaiting review'
			},
			'pending-credit'
		),
		id(23)
	);
	context.entries.push({ ...credit, id: id(23), approval_id: id(101) });
	const [january] = leaveBalanceSummaries(context, id(1), '2027-01-31');
	assert.equal(january?.name, 'Annual leave');
	assert.deepEqual(january?.window, next);
	assert.equal(january?.entitlement, 12);
	assert.equal(january?.balance, 17);
	assert.equal(january?.available, 14);
	assert.equal(january?.pending, 1);
	const [april] = leaveBalanceSummaries(context, id(1), '2027-04-01');
	assert.equal(april?.balance, 12);
	assert.equal(april?.expired, 3, 'expiry reports unused approved credit, not a pending grant');
	assert.equal(april?.available, 12);
});

test('computed balance view uses fiscal years and refuses inaccessible employments', () => {
	const context = facts();
	context.catalogues[0]!.entitlement = {
		...context.catalogues[0]!.entitlement,
		year_start_month: 4
	};
	const before = structuredClone(context);
	const [summary] = leaveBalanceSummaries(context, id(1), '2026-09-01');
	assert.deepEqual(summary?.window, { start: '2026-04-01', end: '2027-03-31' });
	assert.equal(summary?.available, 12);
	assert.deepEqual(context, before, 'view computation creates no annual account or activity');
	assert.throws(() => leaveBalanceSummaries(context, id(999), '2026-09-01'), /approved employment/);
});

test('leave preview is JSON-safe and keeps the unused half available beside a holiday', () => {
	const context = facts();
	context.holidays.push({
		id: id(2027),
		company_id: '00000000-0000-4000-8000-000000000003',
		date: '2026-01-27',
		name: 'Fixture holiday',
		replaces: null,
		published_at: '2025-01-01T00:00:00.000Z'
	});
	approve(context, {
		from_date: '2026-01-26',
		to_date: '2026-01-26',
		half_day_start: false,
		half_day_end: true,
		days: null,
		reason: null
	});
	const preview = evaluateLeavePreview(context, {
		employment_id: id(1),
		catalogue_id: id(7),
		range: {
			start: { date: '2026-01-26', half: 'SECOND' },
			end: { date: '2026-01-27', half: 'SECOND' }
		}
	});
	assert.equal(preview.availability['2026-01-26']?.first_half_available, false);
	assert.equal(preview.availability['2026-01-26']?.second_half_available, true);
	assert.equal(preview.availability['2026-01-27']?.reason_code, 'HOLIDAY');
	assert.equal(preview.chargeable_days, 0.5);
	assert.deepEqual(
		JSON.parse(JSON.stringify(preview)),
		preview,
		'undefined fields cannot cross the command boundary'
	);
});
