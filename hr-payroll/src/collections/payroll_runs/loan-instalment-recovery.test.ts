// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureEmployment } from './lib/measure.ts';
import { settle } from './lib/settle.ts';
import { defaultPayPeriod, attendanceWindow, resolveWindow } from './lib/period.ts';
import { PLAIN_CALENDAR } from './lib/settlement.ts';

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

/** The loan-recovery component the agreement deducts on. */
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

/**
 * The agreement in the report: employment NHPMY0290, six monthly instalments from 2026-04-01, the
 * first of which settles in the 2026-04 run under a cutoff of 21.
 */
function instalment(dueDate, amount) {
	return { due_date: dueDate, amount };
}

function leftoverEntry(sequence, dueDate, amount) {
	return {
		id: `entry-${sequence}`,
		employment_id: 'emp-nhpmy0290',
		pay_component_id: LOAN.id,
		amount,
		quantity: 1,
		event_date: dueDate,
		pay_period: dueDate.slice(0, 7),
		description: `Hari Raya 2026 (NHPMY0290) · repayment ${sequence}/6`,
		origin: {
			kind: 'LOAN_INSTALMENT',
			agreement_id: 'agr-hari-raya-2026',
			sequence,
			of: 6
		}
	};
}

/** Seed leftover recoveries are ONE_OFF, not LOAN_INSTALMENT — same pair the agreement recovers. */
function leftoverOneOffEntry(dueDate, amount) {
	return {
		id: 'entry-one-off-leftover',
		employment_id: 'emp-nhpmy0290',
		pay_component_id: LOAN.id,
		amount,
		quantity: null,
		event_date: dueDate,
		pay_period: dueDate.slice(0, 7),
		origin: {
			kind: 'ONE_OFF',
			note: 'Exact source loan recovery; no principal or disbursement date inferred'
		}
	};
}

function agreement(schedule) {
	return {
		id: 'agr-hari-raya-2026',
		employment_id: 'emp-nhpmy0290',
		pay_component_id: LOAN.id,
		reference: 'Hari Raya 2026 (NHPMY0290)',
		principal: 1000,
		schedule,
		effective_range: { start: '2026-04-01', end: null }
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

function bundle(entries, baseSalary = 3000, extras = {}) {
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
		entries,
		ledger: [],
		timeEntries: [],
		rosterEntries: extras.rosterEntries ?? [],
		agreements: extras.agreements ?? [],
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

function measureApril(entries, options = {}) {
	return measureEmployment({
		bundle: bundle(entries, options.baseSalary, options),
		configuration: configuration(options.payComponents, options.rosterCodes),
		period: '2026-04',
		salary: { start: '2026-04-01', end: '2026-04-30' },
		periodsRemaining: 9,
		headcount: 1,
		policy: PLAIN_CALENDAR,
		consumedInstalments: new Map(options.consumedInstalments ?? [])
	});
}

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

test('the April run writes a payslip line linked to the April instalment', () => {
	const measured = measureApril([], { agreements: [agreement([instalment('2026-04-01', 167)])] });
	const loanLines = measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026');

	assert.equal(loanLines.length, 1, 'the instalment must produce exactly one deduction line');
	assert.equal(loanLines[0].amount, 167, 'a loan instalment is never prorated');
	assert.deepEqual(loanLines[0].component, {
		kind: 'LOAN_INSTALMENT',
		pay_component_id: LOAN.id,
		agreement_id: 'agr-hari-raya-2026',
		sequence: 1
	});
});

test('only the instalment whose due date maps into this run is deducted', () => {
	const measured = measureApril([], { agreements: [agreement(APRIL_SCHEDULE)] });
	const linked = measured.lines
		.filter((line) => line.payComponent.code === 'HARI_RAYA_2026')
		.map((line) => line.component.sequence);

	assert.deepEqual(linked, [1]);
});

test('an instalment due after the cutoff settles in the next period, not this month', () => {
	const measured = measureApril([], {
		agreements: [agreement([instalment('2026-04-25', 167)])]
	});
	assert.equal(
		measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026').length,
		0
	);
});

test('leftover LOAN_INSTALMENT component entries do not double-count the schedule', () => {
	const measured = measureApril([leftoverEntry(1, '2026-04-01', 167)], {
		agreements: [agreement([instalment('2026-04-01', 167)])]
	});
	const loanLines = measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026');
	assert.equal(loanLines.length, 1);
	assert.equal(loanLines[0].component.kind, 'LOAN_INSTALMENT');
	assert.equal(loanLines[0].amount, 167);
});

test('leftover ONE_OFF loan recoveries do not double-count the agreement schedule', () => {
	const measured = measureApril([leftoverOneOffEntry('2026-04-01', 167)], {
		agreements: [agreement([instalment('2026-04-01', 167)])]
	});
	const loanLines = measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026');
	assert.equal(loanLines.length, 1, 'the leftover ONE_OFF must not add a second deduction line');
	assert.equal(loanLines[0].component.kind, 'LOAN_INSTALMENT');
	assert.equal(loanLines[0].amount, 167);
});

test('net-pay protection reduces the instalment but still links and still reports it', () => {
	// A salary of 100 cannot absorb a 167 instalment: the guard must take net to zero rather than
	// negative, and the remainder must survive as a reported shortfall.
	const measured = measureApril([], {
		baseSalary: 100,
		agreements: [agreement([instalment('2026-04-01', 167)])]
	});
	const settlement = settle({ lines: measured.lines, charges: [] });

	assert.equal(settlement.net, 0);
	assert.deepEqual(settlement.shortfalls, [{ payComponentId: LOAN.id, amount: 67 }]);

	const loanLine = settlement.lines.find((line) => line.payComponent.code === 'HARI_RAYA_2026');
	// The line survives the guard, so PERSIST still writes it and the instalment still resolves to a
	// payslip line — which is why a squeezed net can never present as "Not consumed".
	assert.equal(loanLine.amount, 100);
	assert.equal(loanLine.component.kind, 'LOAN_INSTALMENT');
	assert.equal(loanLine.component.agreement_id, 'agr-hari-raya-2026');
	assert.equal(loanLine.component.sequence, 1);
});

test('an ineligible loan component drops the instalment with no line at all', () => {
	// The one measured path that recovers nothing and links nothing. It is silent by design
	// ("an ineligible component produces nothing at all"), so the schedule is the only place an
	// operator can ever see it.
	const ineligible = {
		...LOAN,
		eligibility: [{ field: 'DEPARTMENT', in: ['ENGINEERING'] }]
	};
	const measured = measureApril([], {
		payComponents: [BASIC, ineligible],
		agreements: [agreement([instalment('2026-04-01', 167)])]
	});

	assert.equal(
		measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026').length,
		0
	);
});

test('an as-assigned worker derives their normalized load from that month s WORK roster codes', () => {
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
		rosterEntries: [
			{
				id: 'roster-entry-1',
				work_date: '2026-04-01',
				shift_definition_id: rosterCode.id
			}
		]
	});
	assert.equal(measured.schedule.get('2026-04-01').shift.code, 'PT-AM');
	assert.equal(measured.schedule.get('2026-04-01').normalHours, 4);
	assert.ok(Number.isFinite(measured.ordinaryHourlyRate));
});

/**
 * What a run could not take is not carried anywhere — it is simply still owed.
 *
 * The version this replaces wrote the shortfall into a **new `component_entries` row** dated next
 * month, one facility call per employee, guarded by a `persistShortfalls` that had to delete last
 * build's copies before writing this build's so a rebuild could not make somebody owe the same
 * money twice. That was a second representation of a debt the agreement already records, and every
 * one of its failure modes came from the two copies disagreeing.
 *
 * The debt now stays where it was born. What a run took is on the payslip line that took it, so
 * what is outstanding is the schedule minus the sum of those lines — read from earlier PAID runs by
 * `gather.ts` and handed here. These three tests are that arithmetic: nothing taken, something
 * taken, everything taken.
 */
test('an untouched instalment is deducted in full', () => {
	const measured = measureApril([], {
		agreements: [agreement([instalment('2026-04-01', 167)])],
		consumedInstalments: []
	});
	const loanLines = measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026');
	assert.equal(loanLines.length, 1);
	assert.equal(loanLines[0].amount, 167);
});

test('an instalment an earlier run could only part-pay is re-derived for the remainder', () => {
	// March took 100 of the 167 because net reached zero. April owes the other 67 — and finds it by
	// subtracting what was taken from what the schedule says, never by reading a carried-forward row.
	const measured = measureApril([], {
		agreements: [agreement([instalment('2026-03-01', 167)])],
		consumedInstalments: [['agr-hari-raya-2026:1', 100]]
	});
	const loanLines = measured.lines.filter((line) => line.payComponent.code === 'HARI_RAYA_2026');

	assert.equal(loanLines.length, 1, 'the unpaid remainder must still be recovered');
	assert.equal(loanLines[0].amount, 67);
	assert.equal(
		loanLines[0].component.sequence,
		1,
		'the remainder belongs to the instalment it came from, not to a new one'
	);
});

test('an instalment already settled in full produces no line at all', () => {
	// The widened due-date window is what makes catching up possible, and this is what stops it
	// becoming a second deduction: a settled instalment nets to zero and never reaches a payslip.
	const measured = measureApril([], {
		agreements: [agreement([instalment('2026-03-01', 167), instalment('2026-04-01', 167)])],
		consumedInstalments: [
			['agr-hari-raya-2026:1', 167],
			['agr-hari-raya-2026:2', 0]
		]
	});
	const loanLines = measured.lines
		.filter((line) => line.payComponent.code === 'HARI_RAYA_2026')
		.map((line) => [line.component.sequence, line.amount]);

	assert.deepEqual(loanLines, [[2, 167]], 'only the instalment still owed may appear');
});
