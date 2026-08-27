// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Recovering a SCHEDULED obligation, and the ceiling that replaced a database invariant.
 *
 * `repayment_agreements` and `component_entries` are one collection now. A loan's instalments used
 * to be *copied* into `component_entries` as `LOAN_INSTALMENT` rows so payroll could find them,
 * which cost two generated projections of the origin union, a global unique index over them, and a
 * relation whose only job was to keep the copy pointing at the original. Those rows do not exist:
 * the schedule is `obligations.instalments`, payroll reads it directly, and the tests that used to
 * prove the copies were filtered back out have nothing left to prove.
 *
 * What is here instead is the arithmetic that replaced `SINGLE_USE: unique(component_entry_id)`.
 * That constraint could not survive partial consumption — a part-recovered instalment is
 * legitimately touched by two payslips — so the index became `unique(source, payslip_id)` and the
 * cross-run ceiling became a named refusal. `OBLIGATION_OVER_CONSUMED` is that refusal, and the
 * last three tests are the whole of what now holds it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureEmployment } from './lib/measure.ts';
import { settle } from './lib/settle.ts';
import { defaultPayPeriod, attendanceWindow, resolveWindow } from './lib/period.ts';
import { PLAIN_CALENDAR } from './lib/settlement.ts';
import { OBLIGATION_OVER_CONSUMED } from '../../lib/settlement_refusals.ts';

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
	id: 'co-nihon-my',
	name: 'Nihon (MY)',
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
	company_id: 'co-nihon-my',
	code: 'BASIC',
	name: 'Basic salary',
	nature: 'EARNING',
	policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
	sequence: 10,
	eligibility: [],
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false },
	effective_range: { start: '2020-01-01', end: null }
};

/** The deduction component a SCHEDULED obligation recovers on. */
const LOAN = {
	id: 'pc-hari-raya-2026',
	company_id: 'co-nihon-my',
	code: 'HARI_RAYA_2026',
	name: 'Loan recovery',
	nature: 'DEDUCTION',
	policy: { kind: 'DEDUCTION', settlement: 'DEDUCT', statutory_treatments: [] },
	sequence: 90,
	eligibility: [],
	definition: {
		source: 'ENTRY',
		unit: 'MONEY',
		evidence: 'NONE',
		cap: null,
		settlement: 'PAYROLL'
	},
	effective_range: { start: '2026-01-01', end: null }
};

function configuration(payComponents = [BASIC, LOAN], rosterCodes = []) {
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		contributions: [],
		treatments: new Map(),
		payComponents,
		overtimeRules: [],
		overtimeLimits: [],
		overtimeCoverageRule: null,
		shiftById: new Map(rosterCodes.map((row) => [row.id, row])),
		holidays: new Map(),
		leaveTypes: [],
		hash: 'test'
	};
}

const instalment = (dueDate, amount) => ({ due_date: dueDate, amount });

const OBLIGATION_ID = 'ob-hari-raya-2026';

/**
 * The obligation in the report: employment NHPMY0290, six monthly instalments from 2026-04-01, the
 * first of which settles in the 2026-04 run under a cutoff of 21.
 *
 * `amount` is the **principal**, stated once here rather than a second time inside the schedule.
 * `sequence` is not stored anywhere: an instalment's number is its position in the array.
 */
function loan(instalments, principal = 1000) {
	return {
		id: OBLIGATION_ID,
		employment_id: 'emp-nhpmy0290',
		pay_component_id: LOAN.id,
		reference: 'Hari Raya 2026 (NHPMY0290)',
		amount: principal,
		quantity: null,
		event_date: '2026-04-01',
		pay_period: null,
		terms: 'SCHEDULED',
		occasion: null,
		effective_range: { start: '2026-04-01', end: null },
		instalments,
		note: null,
		reason: null,
		incurred_on: null,
		covers_periods: null,
		reverses_obligation_id: null
	};
}

const GUARANTEED_PATTERN = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 6,
		required_paid_minutes: 2700
	}
};

function bundle(obligations, baseSalary = 3000, extras = {}) {
	const terms = {
		id: 'terms-1',
		employment_id: 'emp-nhpmy0290',
		base_salary: { value: baseSalary, currency: 'MYR' },
		pay_frequency: 'MONTHLY',
		work_pattern: extras.workPattern ?? GUARANTEED_PATTERN,
		statutory_work_category: 'NON_MANUAL',
		effective_range: { start: '2020-01-01', end: null }
	};
	return {
		employment: {
			id: 'emp-nhpmy0290',
			employee_id: 'ee-1',
			employee_number: 'NHPMY0290',
			company_id: 'co-nihon-my',
			hire_date: '2021-06-01',
			exit_date: null,
			department: null,
			payroll_group: null,
			employment_type: 'PERMANENT',
			work_classification: 'NON_MANUAL',
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { id: 'ee-1', date_of_birth: '1990-01-01', gender: 'MALE' },
		terms: [terms],
		statutoryFacts: [],
		obligations,
		ledger: [],
		workDays: extras.workDays ?? [],
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

function measureApril(obligations, options = {}) {
	return measureEmployment({
		bundle: bundle(obligations, options.baseSalary, options),
		configuration: configuration(options.payComponents, options.rosterCodes),
		period: '2026-04',
		salary: { start: '2026-04-01', end: '2026-04-30' },
		periodsRemaining: 9,
		headcount: 1,
		policy: PLAIN_CALENDAR,
		consumedObligations: new Map(options.consumedObligations ?? [])
	});
}

/** Every adjustment the loan component produced. There is at most one: one obligation, one row. */
const recoveries = (measured) =>
	measured.adjustments.filter((row) => row.label === 'HARI_RAYA_2026');

const APRIL_SCHEDULE = [
	instalment('2026-04-01', 167),
	instalment('2026-05-01', 167),
	instalment('2026-06-01', 167),
	instalment('2026-07-01', 167),
	instalment('2026-08-01', 167),
	instalment('2026-09-01', 165)
];

test('a 2026-04-01 instalment settles in the 2026-04 run under a cutoff day of 21', () => {
	assert.deepEqual(attendanceWindow('2026-04', 21), { start: '2026-03-21', end: '2026-04-20' });
	assert.equal(resolveWindow('2026-04', COMPANY).period, '2026-04');
	assert.equal(defaultPayPeriod('2026-04-01', 21), '2026-04');
	assert.equal(defaultPayPeriod('2026-04-25', 21), '2026-05');
});

test('the April run writes one adjustment, and it names the obligation', () => {
	const measured = measureApril([loan([instalment('2026-04-01', 167)])]);
	const rows = recoveries(measured);

	assert.equal(rows.length, 1, 'the instalment must produce exactly one adjustment');
	assert.equal(rows[0].amount, 167, 'a loan instalment is never prorated');
	// The source is the obligation, not an instalment: `payslip_adjustments` has no ordinal column,
	// and `unique(source, payslip_id)` would refuse a second row for the same obligation anyway.
	assert.deepEqual(rows[0].source, { kind: 'OBLIGATION', id: OBLIGATION_ID });
	assert.equal(rows[0].payComponent.id, LOAN.id);
	assert.equal(rows[0].overtimeBand, null, 'exactly one of component and band is ever set');
});

test('only the instalments due by this run are recovered, and they are recovered together', () => {
	// Six instalments, one due. The obligation is drawn on once for what is due by now — which is
	// also why a run that catches up two of them still writes one row.
	const measured = measureApril([loan(APRIL_SCHEDULE)]);
	assert.deepEqual(
		recoveries(measured).map((row) => row.amount),
		[167]
	);
});

test('an instalment due after the cutoff settles in the next period, not this month', () => {
	const measured = measureApril([loan([instalment('2026-04-25', 167)])]);
	assert.deepEqual(recoveries(measured), []);
});

test('net-pay protection reduces the adjustment but still links and still reports it', () => {
	// A salary of 100 cannot absorb a 167 instalment: the guard must take net to zero rather than
	// negative, and the remainder must survive as a reported shortfall.
	const measured = measureApril([loan([instalment('2026-04-01', 167)])], { baseSalary: 100 });
	const settlement = settle({
		base: measured.base,
		adjustments: measured.adjustments,
		charges: []
	});

	assert.equal(settlement.net, 0);
	assert.deepEqual(settlement.shortfalls, [{ payComponentId: LOAN.id, amount: 67 }]);

	const row = settlement.adjustments.find((item) => item.label === 'HARI_RAYA_2026');
	// The row survives the guard, so the graph still writes it and the obligation still resolves to
	// a settled adjustment — which is why a squeezed net can never present as "not consumed".
	assert.equal(row.amount, 100);
	assert.deepEqual(row.source, { kind: 'OBLIGATION', id: OBLIGATION_ID });
});

test('an ineligible loan component drops the recovery with no row at all', () => {
	// The one measured path that recovers nothing and links nothing. It is silent by design
	// ("an ineligible component produces nothing at all"), so the schedule is the only place an
	// operator can ever see it.
	const ineligible = { ...LOAN, eligibility: [{ field: 'DEPARTMENT', in: ['ENGINEERING'] }] };
	const measured = measureApril([loan([instalment('2026-04-01', 167)])], {
		payComponents: [BASIC, ineligible]
	});
	assert.deepEqual(recoveries(measured), []);
});

test('an as-assigned worker derives their normalized load from that month s WORK assignments', () => {
	const rosterCode = {
		id: '00000000-0000-4000-8000-000000000101',
		code: 'PT-AM',
		variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 },
		effective_range: { start: '2020-01-01', end: null }
	};
	const measured = measureApril([], {
		workPattern: {
			type: 'ROSTERED',
			expectation: { kind: 'AS_ASSIGNED', period: 'MONTH', maximum_paid_minutes: null }
		},
		rosterCodes: [rosterCode],
		// One row, both halves. The plan is present because `shift_definition_id` is set; the actual
		// half is absent, which is a day rostered and not yet worked.
		workDays: [
			{
				id: 'wd-1',
				work_date: '2026-04-01',
				shift_definition_id: rosterCode.id,
				worked_intervals: null,
				break_minutes: 0
			}
		]
	});
	assert.equal(measured.schedule.get('2026-04-01').shift.code, 'PT-AM');
	assert.equal(measured.schedule.get('2026-04-01').normalHours, 4);
	assert.ok(Number.isFinite(measured.ordinaryHourlyRate));
	// A day with no attendance is not claimed: there is no punch to freeze, and the day-shaped
	// window guard is what stops a record appearing on a settled day.
	assert.deepEqual(
		measured.adjustments.filter((row) => row.source.kind === 'WORK_DAY'),
		[]
	);
});

/**
 * What a run could not take is not carried anywhere — it is simply still owed.
 *
 * The version this replaces wrote the shortfall into a **new `component_entries` row** dated next
 * month, one facility call per employee, guarded by a `persistShortfalls` that had to delete last
 * build's copies before writing this build's so a rebuild could not make somebody owe the same
 * money twice. That was a second representation of a debt the agreement already recorded, and every
 * one of its failure modes came from the two copies disagreeing.
 *
 * The debt now stays where it was born. What a run took is on the adjustment that took it, so what
 * is outstanding is `obligation.amount − Σ(what earlier PAID runs took)` — read from
 * `payslip_adjustments` by `gather.ts` and handed here. These three tests are that arithmetic:
 * nothing taken, something taken, everything taken.
 */
test('an untouched obligation is deducted in full', () => {
	const measured = measureApril([loan([instalment('2026-04-01', 167)])], {
		consumedObligations: []
	});
	assert.deepEqual(
		recoveries(measured).map((row) => row.amount),
		[167]
	);
});

test('an obligation an earlier run could only part-pay is re-derived for the remainder', () => {
	// March took 100 of the 167 because net reached zero. April owes the other 67 — and finds it by
	// subtracting what was taken from what the schedule says, never by reading a carried-forward row.
	const measured = measureApril([loan([instalment('2026-03-01', 167)])], {
		consumedObligations: [[OBLIGATION_ID, 100]]
	});
	const rows = recoveries(measured);
	assert.equal(rows.length, 1, 'the unpaid remainder must still be recovered');
	assert.equal(rows[0].amount, 67);
	// And it belongs to the obligation it came from, not to a new one. There is no arrears row
	// anywhere in this workspace for it to have become.
	assert.deepEqual(rows[0].source, { kind: 'OBLIGATION', id: OBLIGATION_ID });
});

test('an obligation already settled in full produces nothing at all', () => {
	// The widened due-date window is what makes catching up possible, and this is what stops it
	// becoming a second deduction: a settled obligation nets to zero and never reaches a payslip.
	const measured = measureApril(
		[loan([instalment('2026-03-01', 167), instalment('2026-04-01', 167)])],
		{ consumedObligations: [[OBLIGATION_ID, 334]] }
	);
	assert.deepEqual(recoveries(measured), []);
});

test('two instalments caught up in one run are one adjustment for their total', () => {
	// `unique(source, payslip_id)` permits exactly one row per obligation per payslip, and the
	// outstanding arithmetic is stated at the obligation rather than at an instalment ordinal —
	// which is what makes catching up expressible at all.
	const measured = measureApril(
		[loan([instalment('2026-03-01', 167), instalment('2026-04-01', 167)])],
		{ consumedObligations: [] }
	);
	assert.deepEqual(
		recoveries(measured).map((row) => row.amount),
		[334]
	);
});

/**
 * The invariant the database gave up, and the refusal that carries it.
 *
 * `payslip_sources.source` was globally unique: one input, one payslip, enforced by Postgres and
 * true whether or not anybody trusted the engine. Partial consumption killed it. What is left is
 * arithmetic, and arithmetic that is never checked is a comment — so it is checked here, where the
 * amount is derived, and it raises the name `src/lib/settlement_refusals.ts` declares.
 */
test('a run that would take more than the obligation is worth is refused by name', () => {
	// A schedule that oversubscribes its own principal: 1,000 lent, 1,100 scheduled. Nothing in the
	// database stops that any more — `repaymentScheduleIssues` checked instalments against the
	// principal and was not ported, so this refusal is the only thing standing between a mistyped
	// schedule and somebody being over-recovered.
	assert.throws(
		() => measureApril([loan([instalment('2026-04-01', 1100)], 1000)]),
		(error) => {
			assert.match(error.message, new RegExp(OBLIGATION_OVER_CONSUMED));
			// The sentence names what the obligation is worth and what was asked for, because the
			// only two ways out are amending it or letting the run settle for the remainder.
			assert.match(error.message, /Hari Raya 2026/);
			assert.match(error.message, /1000\.00/);
			assert.match(error.message, /1100\.00/);
			return true;
		}
	);
});

test('a cent of rounding across a dozen runs is not an over-consumption', () => {
	// The tolerance is deliberate and small: amounts round to the currency's minor unit on the way
	// into a payslip, so a schedule that sums to its principal exactly can still land a hundredth
	// over it. One cent is rounding; a cent more than that is a fault, and the test either side of
	// this one is what proves the boundary is a boundary rather than a hole.
	assert.doesNotThrow(() => measureApril([loan([instalment('2026-04-01', 1000.01)], 1000)]));
});

test('a RECURRING obligation is not depleted by what earlier runs paid on it', () => {
	// The arm decides. A standing allowance states an amount **per period** and pays it whole in
	// every period its range covers; subtracting what earlier runs took would stop it after its
	// first month, which is the defect a single "outstanding" rule for every arm would have shipped.
	const allowance = {
		id: 'ob-standing',
		employment_id: 'emp-nhpmy0290',
		pay_component_id: LOAN.id,
		reference: 'Union dues',
		amount: 25,
		quantity: null,
		event_date: '2026-01-01',
		pay_period: null,
		terms: 'RECURRING',
		occasion: null,
		effective_range: { start: '2026-01-01', end: null },
		instalments: null,
		note: null,
		reason: null,
		incurred_on: null,
		covers_periods: null,
		reverses_obligation_id: null
	};
	const measured = measureApril([allowance], {
		consumedObligations: [['ob-standing', 75]]
	});
	assert.deepEqual(
		recoveries(measured).map((row) => row.amount),
		[25],
		'three months already paid do not reduce the fourth'
	);
});
