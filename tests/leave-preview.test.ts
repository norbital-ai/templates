// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateLeavePreview,
	previewWindowOf
} from '../src/lib/leave/preview.ts';

const WORK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ALWAYS = { start: '2020-01-01', end: null };

const leaveType = {
	id: 'lt-annual',
	company_id: 'co-1',
	statutory_profile_id: 'jur-1',
	code: 'ANNUAL',
	name: 'Annual leave',
	statutory_kind: 'ANNUAL',
	eligibility: [],
	encash_on_exit: true,
	requires_certificate_after_days: null,
	accrual: { kind: 'MONTHLY', carry: null },
	entitlement: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [] },
	payroll_effect: { kind: 'PAID' }
};

const profile = {
	id: 'jur-1',
	code: 'PUB',
	lifecycle: 'SEALED',
	currency: 'MYR',
	tax_year_start_month: 1,
	effective_range: ALWAYS,
	statutory_leave: [
		{
			kind: 'ANNUAL',
			ladder: [{ band_from: 0, days: 8 }],
			per_child: null,
			max_days: null,
			authority: 'Fixture'
		}
	]
};

const patternedWeek = {
	type: 'PATTERNED',
	anchor_date: '2021-05-31',
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [
				{ roster_code_id: WORK },
				{ roster_code_id: WORK },
				{ roster_code_id: WORK },
				{ roster_code_id: WORK },
				{ roster_code_id: WORK },
				{ roster_code_id: WORK },
				{ roster_code_id: REST }
			]
		}
	]
};

const facts = {
	employment: {
		id: 'emp-1',
		company_id: 'co-1',
		hire_date: '2021-06-01',
		exit_date: null
	},
	company: { jurisdiction_id: 'jur-1', leave_year_start_month: 1 },
	leaveType,
	holidays: [],
	terms: [
		{
			employment_id: 'emp-1',
			work_pattern: patternedWeek,
			effective_range: { start: '2021-06-01', end: null }
		}
	],
	workDays: [],
	overlappingTimeOff: [],
	ledger: [],
	encashed: false,
	settledRuns: [],
	rosterCodes: [
		{
			id: WORK,
			variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 }
		},
		{ id: REST, variant: { kind: 'REST' } }
	],
	jurisdictionCode: 'PUB',
	sealedProfiles: [profile],
	children: []
};

const wednesday = {
	start: { date: '2026-04-15', half: 'FIRST' },
	end: { date: '2026-04-15', half: 'SECOND' }
};

test('preview window is the month grid, expanded by a range that spills past it', () => {
	assert.deepEqual(previewWindowOf({ employment_id: 'emp-1', leave_type_id: 'lt-1', calendar_month: '2026-04' }), {
		start: '2026-03-30',
		end: '2026-05-10'
	});
	assert.deepEqual(
		previewWindowOf({
			employment_id: 'emp-1',
			leave_type_id: 'lt-1',
			calendar_month: '2026-04',
			range: {
				start: { date: '2026-03-01', half: 'FIRST' },
				end: { date: '2026-03-01', half: 'SECOND' }
			}
		}),
		{ start: '2026-03-01', end: '2026-05-10' }
	);
});

test('a mid-week work day charges one day and leaves remaining days for a later apply', () => {
	const preview = evaluateLeavePreview(facts, {
		employment_id: 'emp-1',
		leave_type_id: 'lt-annual',
		calendar_month: '2026-04',
		range: wednesday
	});
	assert.equal(preview.chargeable_days, 1);
	assert.equal(preview.encashed, false);
	assert.ok(preview.remaining_days != null && preview.remaining_days >= 1);
	assert.equal(preview.issues.length, 0);
	assert.equal(preview.availability['2026-04-15']?.eligible, true);
	assert.equal(preview.availability['2026-04-12']?.reason_code, 'REST_OR_OFF');
});

test('Sunday rest is not chargeable and a Sunday-only range is refused', () => {
	const preview = evaluateLeavePreview(facts, {
		employment_id: 'emp-1',
		leave_type_id: 'lt-annual',
		calendar_month: '2026-04',
		range: {
			start: { date: '2026-04-12', half: 'FIRST' },
			end: { date: '2026-04-12', half: 'SECOND' }
		}
	});
	assert.equal(preview.chargeable_days, 0);
	assert.equal(preview.availability['2026-04-12']?.eligible, false);
	assert.ok(preview.issues.some((row) => row.code === 'NO_CHARGEABLE_DAYS'));
});

test('an overlapping time-off request marks the day and blocks the range', () => {
	const preview = evaluateLeavePreview(
		{
			...facts,
			overlappingTimeOff: [
				{
					id: 'lr-other',
					employment_id: 'emp-1',
					leave_type_id: 'lt-annual',
					kind: 'TIME_OFF',
					from_date: '2026-04-15',
					to_date: '2026-04-15',
					days: 1,
					approval_id: null,
					event: { kind: 'TIME_OFF', range: wednesday, chargeable_days: 1, reason: null }
				}
			]
		},
		{
			employment_id: 'emp-1',
			leave_type_id: 'lt-annual',
			calendar_month: '2026-04',
			range: wednesday
		}
	);
	assert.equal(preview.availability['2026-04-15']?.reason_code, 'OTHER_LEAVE');
	assert.ok(preview.issues.some((row) => row.code === 'OVERLAP'));
});

test('encashment closes the type before any further time off', () => {
	const preview = evaluateLeavePreview(
		{ ...facts, encashed: true },
		{
			employment_id: 'emp-1',
			leave_type_id: 'lt-annual',
			calendar_month: '2026-04',
			range: wednesday
		}
	);
	assert.equal(preview.encashed, true);
	assert.ok(preview.issues.some((row) => row.code === 'ENCASHED'));
});

test('a paid payroll window locks the day the write hook would also refuse', () => {
	const preview = evaluateLeavePreview(
		{
			...facts,
			settledRuns: [
				{
					period: '2026-04',
					lifecycle: 'PAID',
					attendance_from: '2026-03-21',
					attendance_to: '2026-04-20'
				}
			]
		},
		{
			employment_id: 'emp-1',
			leave_type_id: 'lt-annual',
			calendar_month: '2026-04',
			range: wednesday
		}
	);
	assert.equal(preview.availability['2026-04-15']?.reason_code, 'PAID_PAYROLL');
	assert.ok(preview.issues.some((row) => row.code === 'SETTLED_WINDOW'));
});

test('an inverted range is reported instead of charging days', () => {
	const preview = evaluateLeavePreview(facts, {
		employment_id: 'emp-1',
		leave_type_id: 'lt-annual',
		calendar_month: '2026-04',
		range: {
			start: { date: '2026-04-16', half: 'FIRST' },
			end: { date: '2026-04-15', half: 'SECOND' }
		}
	});
	assert.equal(preview.chargeable_days, null);
	assert.ok(preview.issues.some((row) => row.code === 'RANGE_INVERTED'));
});
