// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLeavePreview, previewWindowOf } from '../src/lib/leave/preview.ts';

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
	entitlement: { layers: [] },
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

const allocation = {
	id: 'allocation-1',
	employment_id: 'emp-1',
	leave_type_id: 'lt-annual',
	allocated_days: 5,
	starts_on: '2026-01-01',
	expires_on: '2026-12-31',
	approval_id: null
};
const eventFacts = {
	...facts,
	leaveType: { ...leaveType, accrual: { kind: 'PER_EVENT' } },
	allocations: [allocation]
};
const eventInput = {
	employment_id: 'emp-1',
	leave_type_id: 'lt-annual',
	allocation_id: allocation.id,
	range: wednesday
};

test('event leave requires an approved allocation belonging to the employment and leave type', () => {
	for (const allocations of [
		[],
		[{ ...allocation, approval_id: 'review' }],
		[{ ...allocation, employment_id: 'other' }],
		[{ ...allocation, leave_type_id: 'other' }]
	]) {
		const preview = evaluateLeavePreview({ ...eventFacts, allocations }, eventInput);
		assert.equal(preview.remaining_days, 0);
		assert.ok(preview.issues.some((issue) => issue.code === 'ALLOCATION_REQUIRED'));
	}
	const valid = evaluateLeavePreview(eventFacts, eventInput);
	assert.equal(valid.remaining_days, 5);
	assert.equal(valid.chargeable_days, 1);
	assert.deepEqual(valid.issues, []);
});

test('event allowance counts approved and pending requests across years, and excludes only the request being edited', () => {
	const ledger = [
		{
			id: 'approved',
			allocation_id: allocation.id,
			approval_id: null,
			event: { kind: 'TIME_OFF', chargeable_days: 3 }
		},
		{
			id: 'pending',
			allocation_id: allocation.id,
			approval_id: 'review',
			event: { kind: 'TIME_OFF', chargeable_days: 1.5 }
		},
		{
			id: 'unrelated',
			allocation_id: 'other-event',
			event: { kind: 'TIME_OFF', chargeable_days: 90 }
		}
	];
	const preview = evaluateLeavePreview({ ...eventFacts, ledger }, eventInput);
	assert.equal(preview.remaining_days, 0.5);
	assert.ok(preview.issues.some((issue) => issue.code === 'OVERDRAW'));
	const edit = evaluateLeavePreview(
		{ ...eventFacts, ledger },
		{ ...eventInput, exclude_request_id: 'pending' }
	);
	assert.equal(edit.remaining_days, 2);
	assert.deepEqual(edit.issues, []);
	const nextYear = evaluateLeavePreview(
		{ ...eventFacts, ledger, allocations: [{ ...allocation, expires_on: '2027-04-14' }] },
		{
			...eventInput,
			range: {
				start: { date: '2027-01-04', half: 'FIRST' },
				end: { date: '2027-01-04', half: 'SECOND' }
			}
		}
	);
	assert.equal(nextYear.remaining_days, 0.5);
	assert.ok(nextYear.issues.some((issue) => issue.code === 'OVERDRAW'));
});

test('event leave refuses requests outside the allocation window; annual leave cannot borrow that allocation', () => {
	for (const dates of [{ starts_on: '2026-04-16' }, { expires_on: '2026-04-14' }]) {
		const preview = evaluateLeavePreview(
			{ ...eventFacts, allocations: [{ ...allocation, ...dates }] },
			eventInput
		);
		assert.ok(preview.issues.some((issue) => issue.code === 'ALLOCATION_WINDOW'));
	}
	assert.ok(
		evaluateLeavePreview(facts, eventInput).issues.some(
			(issue) => issue.code === 'ALLOCATION_REQUIRED'
		)
	);
});

test('preview window is the month grid, expanded by a range that spills past it', () => {
	assert.deepEqual(
		previewWindowOf({ employment_id: 'emp-1', leave_type_id: 'lt-1', calendar_month: '2026-04' }),
		{
			start: '2026-03-30',
			end: '2026-05-10'
		}
	);
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

test('missing historical law refuses inferred carry instead of backdating today’s entitlement', () => {
	const preview = evaluateLeavePreview(
		{
			...facts,
			employment: { ...facts.employment, hire_date: '2019-01-01' },
			terms: [
				{
					...facts.terms[0],
					effective_range: { start: '2019-01-01', end: null }
				}
			],
			leaveType: {
				...leaveType,
				accrual: { kind: 'MONTHLY', carry: { limit_days: 14, expiry_months: 12 } }
			},
			sealedProfiles: [{ ...profile, effective_range: { start: '2026-01-01', end: null } }]
		},
		{
			employment_id: 'emp-1',
			leave_type_id: 'lt-annual',
			calendar_month: '2026-04',
			range: wednesday
		}
	);
	assert.equal(
		preview.issues.some((row) => row.code === 'MISSING_PROFILE'),
		true
	);
	assert.equal(preview.remaining_days, null);
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
