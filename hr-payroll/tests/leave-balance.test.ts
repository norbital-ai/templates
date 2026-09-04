// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Leave entitlement and the derived balance.
 *
 * Carry-forward is the one figure that IS written: `process_leave_year` posts it once as a
 * `CARRY_FORWARD` event, and every read below takes it from that posted row — or, for a year HR
 * has not processed yet, provisionally from last year's closing off last year's posted row (or
 * zero, never a second provisional level). Nothing walks to the hire year.
 *
 * Every expected number below is derived from the documented rule, not copied from a run:
 *
 *   - twelve monthly increments of a 21-day entitlement sum to exactly 21, because the *cumulative*
 *     figure is rounded and not each month (rounding each 1.75 up to 2.0 would give 24);
 *   - a quarter of that same entitlement is 5.25 days, which rounds half-up to 5.5;
 *   - a carry-forward is clamped to `limit_days` and counts only rows that have settled;
 *   - what expires is the carry-in minus what was already spent against it before the deadline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	accruedDays,
	carryInto,
	closingBalance,
	expiredDays,
	leaveBalance,
	leaveYearOf,
	leaveYearStart,
	resolveEntitlement
} from '../src/collections/payroll_runs/lib/leave.ts';

const ALWAYS = { start: '2020-01-01', end: null };

/** A sealed statutory profile stating two floors: a service ladder, and a child-scaled kind. */
const PROFILE = {
	id: 'jur-my',
	code: 'MY',
	currency: 'MYR',
	tax_year_start_month: 1,
	effective_range: ALWAYS,
	statutory_leave: [
		{
			kind: 'ANNUAL',
			ladder: [
				{ band_from: 0, days: 8 },
				{ band_from: 24, days: 12 }
			],
			per_child: null,
			max_days: null,
			authority: 'EA 1955 s.60E'
		},
		{
			kind: 'CHILDCARE',
			ladder: [{ band_from: 0, days: 0 }],
			per_child: { days: 2, age_limit: 7, min_children: 1 },
			max_days: 6,
			authority: 'Fixture childcare statute'
		}
	]
};

const annualLeaveType = (overrides = {}) => ({
	id: 'lt-annual',
	company_id: 'co-my',
	statutory_profile_id: 'jur-my',
	code: 'ANNUAL',
	name: 'Annual leave',
	statutory_kind: 'ANNUAL',
	eligibility: [],
	encash_on_exit: true,
	requires_certificate_after_days: null,
	accrual: { kind: 'MONTHLY', carry: null },
	entitlement: { layers: [] },
	payroll_effect: { kind: 'PAID' },
	...overrides
});

const layer = (level, days, extra = {}) => ({
	level,
	band_from: 0,
	days,
	...extra
});

const entitled = (leaveType, options = {}) =>
	resolveEntitlement({
		leaveType,
		profile: PROFILE,
		children: options.children ?? [],
		serviceMonths: options.serviceMonths ?? 0,
		employmentId: options.employmentId ?? 'emp-1',
		asOf: options.asOf ?? '2026-06-01'
	});

// ── entitlement: the statutory floor is a floor ─────────────────────────────────────────────────

test('the statutory ladder supplies the entitlement when the company states no layer', () => {
	assert.equal(entitled(annualLeaveType(), { serviceMonths: 0 }), 8);
	// The highest band at or below the service age, not the first that matches.
	assert.equal(entitled(annualLeaveType(), { serviceMonths: 23 }), 8);
	assert.equal(entitled(annualLeaveType(), { serviceMonths: 24 }), 12);
	assert.equal(entitled(annualLeaveType(), { serviceMonths: 400 }), 12);
});

test('a company layer below the statutory floor does not reduce the entitlement', () => {
	const stingy = annualLeaveType({
		entitlement: { layers: [layer('ORGANISATION', 5)] }
	});
	// Mis-typing the handbook cannot make the company non-compliant.
	assert.equal(entitled(stingy, { serviceMonths: 0 }), 8);
});

test('a more generous organisation layer wins, and an employee layer wins over it', () => {
	const generous = annualLeaveType({
		entitlement: {
			layers: [layer('ORGANISATION', 14), layer('EMPLOYEE', 20, { employment_id: 'emp-1' })]
		}
	});
	assert.equal(entitled(generous, { employmentId: 'emp-1' }), 20);
	// Somebody else's negotiated layer is not theirs.
	assert.equal(entitled(generous, { employmentId: 'emp-2' }), 14);
});

test('a layer above the service band is not read', () => {
	const senior = annualLeaveType({
		entitlement: {
			layers: [layer('ORGANISATION', 30, { band_from: 24 })]
		}
	});
	assert.equal(entitled(senior, { serviceMonths: 12 }), 8);
	assert.equal(entitled(senior, { serviceMonths: 24 }), 30);
});

// ── entitlement: the child-scaled floor ─────────────────────────────────────────────────────────

const childcareLeaveType = () =>
	annualLeaveType({ id: 'lt-childcare', code: 'CHILDCARE', statutory_kind: 'CHILDCARE' });

const child = (id, birthdate, extra = {}) => ({
	id,
	child_birthdate: birthdate,
	supersedes_id: null,
	effective_range: null,
	...extra
});

test('a child-scaled floor adds per eligible child and stops at the statutory ceiling', () => {
	const two = entitled(childcareLeaveType(), {
		children: [child('c1', '2022-03-01'), child('c2', '2023-04-02')],
		asOf: '2026-06-01'
	});
	assert.equal(two, 4);
	const four = entitled(childcareLeaveType(), {
		children: [
			child('c1', '2022-03-01'),
			child('c2', '2023-04-02'),
			child('c3', '2024-05-03'),
			child('c4', '2025-06-04')
		],
		asOf: '2026-06-01'
	});
	// 2 × 4 = 8 days, capped by the statute's own ceiling of 6.
	assert.equal(four, 6);
});

test('a child-conditioned kind grants nothing when its gate is not met', () => {
	assert.equal(entitled(childcareLeaveType(), { children: [] }), 0);
	// Over the age limit as of the date: eleven completed years against a limit of seven.
	assert.equal(
		entitled(childcareLeaveType(), { children: [child('c1', '2015-01-01')], asOf: '2026-06-01' }),
		0
	);
	// A superseded fact is not a child.
	assert.equal(
		entitled(childcareLeaveType(), {
			children: [child('c1', '2022-03-01', { supersedes_id: 'c0' })],
			asOf: '2026-06-01'
		}),
		0
	);
});

// ── accrual ────────────────────────────────────────────────────────────────────────────────────

const accrue = (overrides = {}) =>
	accruedDays({
		leaveType: annualLeaveType(),
		entitlementAt: () => 21,
		hireDate: '2020-01-01',
		exitDate: null,
		leaveYearStart: '2026-01-01',
		asOf: '2026-12-31',
		...overrides
	});

test('twelve monthly increments of a 21-day entitlement sum to exactly the entitlement', () => {
	// The claim the module's own header makes. Rounding each 1.75 to 2.0 and summing would be 24.
	assert.equal(accrue(), 21);
});

test('a quarter of the leave year accrues 5.25 days and rounds half-up to 5.5', () => {
	assert.equal(accrue({ asOf: '2026-03-31' }), 5.5);
});

test('a mid-year joiner and a mid-year leaver are prorated without a flag', () => {
	assert.equal(accrue({ hireDate: '2026-07-01' }), 10.5);
	assert.equal(accrue({ exitDate: '2026-06-30' }), 10.5);
	// A partial month counts by calendar days rather than as a whole month.
	assert.equal(accrue({ asOf: '2026-01-15' }), 1);
});

test('a leave year that has not started yet accrues nothing', () => {
	assert.equal(accrue({ hireDate: '2027-01-01' }), 0);
});

test('upfront accrual grants the whole band and is not re-prorated by hire date', () => {
	const upfront = annualLeaveType({ accrual: { kind: 'UPFRONT', carry: null } });
	assert.equal(accrue({ leaveType: upfront, hireDate: '2026-07-01' }), 21);
});

test('a per-event leave type has no balance to accrue', () => {
	const perEvent = annualLeaveType({ accrual: { kind: 'PER_EVENT' } });
	assert.equal(accrue({ leaveType: perEvent }), 0);
});

// ── carry-forward and expiry ────────────────────────────────────────────────────────────────────

const taken = (id, date, days, extra = {}) => ({
	id,
	leave_type_id: 'lt-annual',
	entry_date: date,
	kind: 'TAKEN',
	days,
	source_id: `req-${id}`,
	approval_id: null,
	...extra
});

/** A posted `CARRY_FORWARD` row as the ledger reads it: the year it opens, its days, its lapse day. */
const carryRow = (id, year, days, expires) => ({
	id,
	leave_type_id: 'lt-annual',
	entry_date: `${year}-01-01`,
	kind: 'CARRY_FORWARD',
	days,
	source_id: null,
	approval_id: null,
	leave_year: year,
	expires_on: expires
});

const balanceInput = (overrides = {}) => ({
	leaveType: annualLeaveType({
		accrual: { kind: 'MONTHLY', carry: { limit_days: 5, expiry_months: 3 } }
	}),
	entitlementAt: () => 21,
	hireDate: '2024-01-01',
	exitDate: null,
	leaveYearStartMonth: 1,
	ledger: [],
	basis: 'SETTLED',
	...overrides
});

test('the leave year is named by the year it starts in', () => {
	assert.equal(leaveYearStart('2026-03-15', 1), '2026-01-01');
	assert.equal(leaveYearStart('2026-03-15', 4), '2025-04-01');
	assert.equal(leaveYearOf('2026-03-15', 4), 2025);
});

test('nothing is carried into the hire year, and the provisional carry is clamped to the limit', () => {
	const input = balanceInput();
	assert.deepEqual(carryInto(input, 2024), { days: 0, expires_on: null, state: 'NONE' });
	// 21 days accrued and none taken: last year's closing from last year's posted row (or zero),
	// capped by the five-day carry limit and marked provisional until HR processes the year.
	assert.deepEqual(carryInto(input, 2025), {
		days: 5,
		expires_on: '2025-04-01',
		state: 'PROVISIONAL'
	});
});

test('leave taken reduces the provisional carry-forward, and a still-unapproved request does not', () => {
	assert.equal(carryInto(balanceInput({ ledger: [taken('l1', '2024-08-01', -18)] }), 2025).days, 3);
	// Decision L7: an unapproved request must not be able to consume next year's balance permanently.
	assert.equal(
		carryInto(
			balanceInput({ ledger: [taken('l1', '2024-08-01', -18, { approval_id: 'ap-1' })] }),
			2025
		).days,
		5
	);
});

test('a posted carry is the fact: processing posts the provisional figure unchanged', () => {
	const provisional = balanceInput({ ledger: [taken('l1', '2024-08-01', -18)] });
	const before = leaveBalance(provisional, '2025-06-30');
	const posted = balanceInput({
		ledger: [taken('l1', '2024-08-01', -18), carryRow('c1', 2025, 3, '2025-04-01')]
	});
	assert.equal(carryInto(posted, 2025).state, 'POSTED');
	assert.equal(leaveBalance(posted, '2025-06-30'), before);
});

test('a negative closing carries zero and keeps the negative in the closing', () => {
	const input = balanceInput({ ledger: [taken('l1', '2024-03-01', -30)] });
	assert.equal(closingBalance(input, 2024).closing, 21 - 30);
	assert.equal(carryInto(input, 2025).days, 0);
});

test('a leave type with no carry policy carries nothing forward and expires nothing', () => {
	const input = balanceInput({
		leaveType: annualLeaveType({ accrual: { kind: 'MONTHLY', carry: null } })
	});
	assert.deepEqual(carryInto(input, 2025), { days: 0, expires_on: null, state: 'NONE' });
	assert.equal(expiredDays(input, 2025), 0);
});

test('carried-in days lapse only after the expiry date, and only what is still unspent', () => {
	const posted = (ledger = []) =>
		balanceInput({ ledger: [carryRow('c1', 2025, 5, '2025-04-01'), ...ledger] });
	// Three months into the leave year is the deadline; before it, nothing has lapsed.
	assert.equal(expiredDays(posted(), 2025, '2025-03-31'), 0);
	assert.equal(expiredDays(posted(), 2025, '2025-12-31'), 5);
	// Oldest-first: three days taken before the deadline were charged against the carry-in, so only
	// two remain to lapse. Charging this year's accrual first would lose all five.
	assert.equal(expiredDays(posted([taken('l1', '2025-02-10', -3)]), 2025, '2025-12-31'), 2);
	// Spending more than the carry-in cannot make the expiry negative.
	assert.equal(expiredDays(posted([taken('l1', '2025-02-10', -6)]), 2025, '2025-12-31'), 0);
});

// ── the composed balance ────────────────────────────────────────────────────────────────────────

test('the balance is carry-in plus accrual minus expiry plus the ledger', () => {
	const ledger = [carryRow('c1', 2025, 5, '2025-04-01'), taken('l1', '2025-02-10', -3)];
	// 5 carried in (posted) + 10.5 accrued to 30 June − 2 lapsed at the 1 April deadline − 3 taken.
	assert.equal(leaveBalance(balanceInput({ ledger }), '2025-06-30'), 10.5);
});

test('a projected balance counts a request still awaiting approval and a settled one does not', () => {
	const ledger = [
		carryRow('c1', 2025, 5, '2025-04-01'),
		taken('l1', '2025-02-10', -3),
		taken('l2', '2025-05-01', -2, { approval_id: 'ap-1' })
	];
	assert.equal(leaveBalance(balanceInput({ ledger }), '2025-06-30'), 10.5);
	assert.equal(leaveBalance(balanceInput({ ledger, basis: 'PROJECTED' }), '2025-06-30'), 8.5);
});

test('a movement outside the leave year under measurement is not counted in it', () => {
	const ledger = [taken('l1', '2024-08-01', -18)];
	// 2024's spending shows up as a smaller provisional carry-in for 2025, never as a 2025 movement.
	assert.equal(leaveBalance(balanceInput({ ledger }), '2025-06-30'), 3 + 10.5 - 3);
});
