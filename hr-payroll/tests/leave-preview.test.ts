// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLeavePreview, previewWindowOf } from '../src/lib/leave/preview.ts';

const WORK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const range = {
	start: { date: '2026-04-15', half: 'FIRST' },
	end: { date: '2026-04-15', half: 'SECOND' }
};
const account = {
	id: 'account-2026',
	employment_id: 'emp-1',
	leave_code: 'ANNUAL',
	status: 'OPEN',
	starts_on: '2026-01-01',
	ends_on: '2026-12-31',
	accrual_kind: 'UPFRONT'
};
const leaveType = {
	id: 'lt-annual',
	company_id: 'co-1',
	leave_plan_id: 'plan-1',
	code: 'ANNUAL',
	name: 'Annual leave',
	statutory_kind: 'ANNUAL',
	eligibility: [],
	requires_certificate_after_days: null,
	accrual: { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } },
	entitlement: { layers: [] },
	payroll_effect: { kind: 'PAID' }
};
const patternedWeek = {
	type: 'PATTERNED',
	anchor_date: '2021-05-31',
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [WORK, WORK, WORK, WORK, WORK, WORK, REST].map((roster_code_id) => ({
				roster_code_id
			}))
		}
	]
};
const facts = {
	gender: 'FEMALE',
	employment: { id: 'emp-1', company_id: 'co-1', hire_date: '2021-06-01', exit_date: null },
	leaveType,
	planActive: true,
	account,
	entries: [
		{ kind: 'OPENING_ENTITLEMENT', days: 5, effective_on: '2026-01-01', approval_id: null }
	],
	holidays: [],
	terms: [
		{
			employment_id: 'emp-1',
			work_pattern: patternedWeek,
			effective_range: { start: '2021-06-01', end: null },
			employment_type: 'PERMANENT'
		}
	],
	workDays: [],
	requests: [],
	settledRuns: [],
	rosterCodes: [
		{
			id: WORK,
			variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 }
		},
		{ id: REST, variant: { kind: 'REST' } }
	]
};
const input = {
	employment_id: 'emp-1',
	leave_type_id: 'lt-annual',
	leave_account_id: account.id,
	calendar_month: '2026-04',
	range
};

test('an application requires one open account covering the complete range', () => {
	const missing = evaluateLeavePreview({ ...facts, account: null, entries: [] }, input);
	assert.ok(missing.issues.some((issue) => issue.code === 'ACCOUNT_REQUIRED'));
	const closed = evaluateLeavePreview(
		{ ...facts, account: { ...account, status: 'CLOSED' } },
		input
	);
	assert.ok(closed.issues.some((issue) => issue.code === 'ACCOUNT_REQUIRED'));
});

test('posted entries and held applications share the same availability check', () => {
	const pending = {
		id: 'pending-1',
		approval_id: 'approval-1',
		leave_account_id: account.id,
		days: 3,
		event: {
			kind: 'TIME_OFF',
			range: {
				start: { date: '2026-05-01', half: 'FIRST' },
				end: { date: '2026-05-03', half: 'SECOND' }
			},
			chargeable_days: 3
		}
	};
	const preview = evaluateLeavePreview({ ...facts, requests: [pending] }, input);
	assert.equal(preview.remaining_days, 2);
	assert.equal(preview.chargeable_days, 1);
	assert.deepEqual(preview.issues, []);
	const overdrawn = evaluateLeavePreview({ ...facts, requests: [{ ...pending, days: 5 }] }, input);
	assert.ok(overdrawn.issues.some((issue) => issue.code === 'OVERDRAW'));
});

test('unmetered leave keeps account, schedule, overlap and approval checks but has no balance ceiling', () => {
	const preview = evaluateLeavePreview(
		{
			...facts,
			account: { ...account, accrual_kind: 'UNLIMITED' },
			entries: [],
			leaveType: { ...leaveType, accrual: { kind: 'UNLIMITED' } }
		},
		input
	);
	assert.equal(preview.remaining_days, 0);
	assert.equal(preview.chargeable_days, 1);
	assert.equal(
		preview.issues.some((issue) => issue.code === 'OVERDRAW'),
		false
	);
});

test('eligibility and certificate policy use server-measured scheduled days', () => {
	const restrictedType = {
		...leaveType,
		requires_certificate_after_days: 0,
		eligibility: [
			{ field: 'GENDER', in: ['FEMALE'] },
			{ field: 'EMPLOYMENT_TYPE', in: ['PERMANENT'] }
		]
	};
	const preview = evaluateLeavePreview(
		{
			...facts,
			leaveType: restrictedType
		},
		input
	);
	assert.equal(preview.certificate_required, true);
	assert.equal(preview.chargeable_days, 1);
	const ineligible = evaluateLeavePreview(
		{ ...facts, gender: 'MALE', leaveType: restrictedType },
		input
	);
	assert.ok(ineligible.issues.some((issue) => issue.code === 'INELIGIBLE'));
});

test('preview month expands to the rendered calendar grid', () => {
	assert.deepEqual(
		previewWindowOf({ employment_id: 'emp-1', leave_type_id: 'lt-1', calendar_month: '2026-04' }),
		{ start: '2026-03-30', end: '2026-05-10' }
	);
});
