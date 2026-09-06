// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { entryEventDate, entryPayPeriod } from '../src/collections/payroll_runs/lib/entries.ts';
import { measureEmployment } from '../src/collections/payroll_runs/lib/measure.ts';
import { PLAIN_CALENDAR } from '../src/collections/payroll_runs/lib/settlement.ts';

const JURISDICTION = {
	id: 'jur-my',
	code: 'MY',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate_divisor: 26,
	ordinary_rate_basis: 'DAYS_PER_MONTH',
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
};

const COMPANY = {
	id: 'co-pub-my',
	name: 'Public Fixture Co',
	jurisdiction_id: 'jur-my',
	pay_cutoff_day: 21,
	pay_day: 25,
	leave_year_start_month: 1,
	overtime_calculation_method: 'STATUTORY_AGGREGATE',
	risk_class: null,
	settlement_policy: null,
	effective_range: { start: '2020-01-01', end: null }
};

const BASIC = {
	id: 'pc-basic',
	company_id: 'co-pub-my',
	code: 'BASIC',
	name: 'Basic salary',
	nature: 'EARNING',
	policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
	sequence: 10,
	eligibility: [],
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
};

const NPL = {
	id: '00000000-0000-4000-8000-0000000000n1',
	company_id: 'co-pub-my',
	code: 'NPL',
	name: 'Unpaid leave',
	nature: 'ABSENCE',
	policy: { kind: 'ABSENCE', settlement: 'DEDUCT', statutory_treatments: [] },
	sequence: 20,
	eligibility: [],
	definition: { source: 'FORMULA', unit: 'MONEY', expr: '100.0' }
};

const NPL_TYPE = {
	id: '00000000-0000-4000-8000-0000000000t1',
	company_id: 'co-pub-my',
	leave_plan_id: 'plan-pub-my',
	code: 'NPL',
	name: 'Unpaid leave',
	eligibility: [],
	statutory_kind: null,
	exit_settlement: { exit: 'FORFEIT' },
	requires_certificate_after_days: null,
	accrual: { kind: 'UNLIMITED' },
	entitlement: { layers: [] },
	payroll_effect: { kind: 'UNPAID', component_id: NPL.id }
};

const GUARANTEED_PATTERN = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 6,
		required_paid_minutes: 2700
	}
};

function configuration(leaveTypes = [NPL_TYPE]) {
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		leaveProfiles: [JURISDICTION],
		contributions: [],
		treatments: new Map(),
		payComponents: [BASIC, NPL],
		overtimeRules: [],
		overtimeLimits: [],
		overtimeCoverageRule: null,
		shiftById: new Map(),
		holidays: new Map(),
		leaveTypes,
		hash: 'test'
	};
}

function bundle(ledger = []) {
	return {
		employment: {
			id: 'emp-nhpmy0290',
			employee_id: 'ee-1',
			employee_number: 'PUBEM0290',
			company_id: 'co-pub-my',
			hire_date: '2021-06-01',
			exit_date: null,
			department: null,
			payroll_group: null,
			employment_type: 'PERMANENT',
			work_classification: 'NON_MANUAL',
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { id: 'ee-1', date_of_birth: '1990-01-01', gender: 'MALE' },
		terms: [
			{
				id: 'terms-1',
				employment_id: 'emp-nhpmy0290',
				base_salary: { value: 3000, currency: 'MYR' },
				pay_frequency: 'MONTHLY',
				work_pattern: GUARANTEED_PATTERN,
				statutory_work_category: 'NON_MANUAL',
				effective_range: { start: '2020-01-01', end: null }
			}
		],
		statutoryFacts: [],
		componentEntries: [],
		loans: [],
		loanRepayments: [],
		ledger,
		leaveAccounts: [],
		leaveEntries: [],
		workDays: [],
		serviceMonths: 58,
		age: 36,
		employedDays: { start: '2026-04-01', end: '2026-04-30' },
		wageDays: { start: '2026-04-01', end: '2026-04-30' },
		attendance: { start: '2026-03-21', end: '2026-04-20' },
		arrearsFor: null,
		deferral: null,
		extendedLeaveSettlesInOwnMonth: false
	};
}

const leaveDay = (id, date, days = -1) => ({
	id,
	leave_type_id: NPL_TYPE.id,
	entry_date: date,
	kind: 'TAKEN',
	days,
	source_id: id,
	approval_id: null
});

function measure(ledger) {
	return measureEmployment({
		bundle: bundle(ledger),
		configuration: configuration(),
		period: '2026-04',
		salary: { start: '2026-04-01', end: '2026-04-30' },
		periodsRemaining: 9,
		headcount: 1,
		policy: PLAIN_CALENDAR,
		consumedEntries: new Map(),
		consumedRepayments: new Map()
	});
}

test('unpaid leave is an adjustment naming the leave request that caused it', () => {
	const leaveRequestId = '00000000-0000-4000-8000-0000000000r1';
	const measured = measure([leaveDay(leaveRequestId, '2026-04-10')]);
	const npl = measured.adjustments.filter((row) => row.label === 'NPL');
	assert.equal(npl.length, 1);
	// The input replaces `LEAVE_UNPAID`'s `leave_request_ids` array. One row, one request, and the
	// database enforces the arc: a `restrict` foreign key on the LEAVE_REQUEST arm is the lock.
	assert.deepEqual(npl[0].input, { family: 'LEAVE_REQUEST', id: leaveRequestId });
	assert.equal(npl[0].payComponent.id, NPL.id);
	assert.equal(npl[0].quantity, 1);
	assert.equal(npl[0].amount, 100, 'the formula’s own figure, unapportioned: there is one request');
	// And it is not base. Base is what the contract produced; this was caused by a record somebody
	// can edit, and that is the whole of what makes it an adjustment.
	assert.deepEqual(
		measured.base.map((item) => item.label),
		['BASIC']
	);
});

test('one absence across three requests is three rows that sum to the formula’s amount', () => {
	// `unique(source, payslip_id)` means a row cannot name three requests, and the old
	// `leave_request_ids` array is exactly the shape that had to go. The amount is apportioned by
	// the days each request contributed and the rounding residue lands on the last, so the parts sum
	// to what the formula produced and the quantities sum to the days it was produced from.
	const measured = measure([
		leaveDay('lr-a', '2026-04-08'),
		leaveDay('lr-b', '2026-04-09'),
		leaveDay('lr-c', '2026-04-10')
	]);
	const npl = measured.adjustments.filter((row) => row.label === 'NPL');
	assert.deepEqual(
		npl.map((row) => row.input.id),
		['lr-a', 'lr-b', 'lr-c']
	);
	assert.equal(
		Math.round(npl.reduce((total, row) => total + row.amount, 0) * 100) / 100,
		100,
		'100.00 over three days is 33.33 + 33.33 + 33.34, never 99.99'
	);
	assert.deepEqual(
		npl.map((row) => row.amount),
		[33.33, 33.33, 33.34]
	);
	assert.equal(
		npl.reduce((total, row) => total + row.quantity, 0),
		3
	);
});

test('a request that started before this window is still captured when its days reach this window', () => {
	const leaveRequestId = '00000000-0000-4000-8000-0000000000r2';
	const measured = measure([
		{
			id: leaveRequestId,
			leave_type_id: NPL_TYPE.id,
			entry_date: '2026-03-15',
			through_date: '2026-04-05',
			kind: 'TAKEN',
			days: -12,
			source_id: leaveRequestId,
			approval_id: null
		}
	]);
	assert.ok(
		measured.captured.leaveRequests.includes(leaveRequestId),
		'April must capture a 15 Mar–5 Apr request for the April days, not only when the start sits in lockSpan'
	);
});

test('a formula component with no unpaid leave in the window is base, because nothing caused it', () => {
	const measured = measure([]);
	const npl = measured.base.filter((item) => item.label === 'NPL');
	assert.equal(npl.length, 1);
	assert.deepEqual(npl[0].entry, { component_code: 'NPL', amount: 100 });
	// No adjustment at all: an amount with no source is not an adjustment, it is base — and there is
	// no `kind` column anywhere to declare which, because the kind is derived from what it points at.
	assert.deepEqual(
		measured.adjustments.filter((row) => row.label === 'NPL'),
		[]
	);
});

test('a claim with an incurred date settles by that date, not event_date', () => {
	// The claim's incurred day is the economic fact; the cutoff reads it, not the entry date.
	const claim = {
		id: 'claim-1',
		event: { kind: 'CLAIM', incurred_on: '2026-04-10', description: null },
		pay_period: null,
		event_date: '2026-04-25T00:00:00.000Z'
	};
	assert.equal(entryPayPeriod(claim, 21), '2026-04');
	assert.equal(entryEventDate(claim), '2026-04-10');
});

test('an entry that is not a claim falls back to its event date for the cutoff', () => {
	const entered = {
		id: 'claim-2',
		event: { kind: 'BONUS', note: null },
		pay_period: null,
		event_date: '2026-04-25T00:00:00.000Z'
	};
	assert.equal(entryPayPeriod(entered, 21), '2026-05');
});
