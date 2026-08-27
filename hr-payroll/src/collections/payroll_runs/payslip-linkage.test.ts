// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run consumes pay components, obligations and clocks, and produces the three shapes a
 * payslip stores.
 *
 * The pieces of that sentence are each pinned somewhere already: `overtime-derivation.test.ts`
 * drives `deriveDailyOvertime` and `priceDay`, and `verify-payroll-arithmetic.mjs` drives
 * `prorationFraction`'s divisors, the statutory ladders and which run a period settles in. What
 * nothing drove is the join — `measureEmployment`, the step that reads a bundle and decides which
 * pay component receives which money. Everything below is that step, and every figure is the one
 * the arithmetic gate already verifies for this employee: basic 3,451 over a six-day 48-hour week
 * in Malaysia, so the ordinary rate is 3,451 / 26 / 8 = 16.59 and a day's wages is 132.73.
 *
 * MEASURE emits `base`, `proration` and `adjustments` rather than one flat list, and which plane an
 * amount lands in is derived from what caused it: the contract produces base, the calendar produces
 * the proration segments behind it, and anything one editable record caused is an adjustment naming
 * that record. `amountOf` below reads across both money-bearing planes, because gross does not care
 * which table a figure will be stored in.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE CUT-OFF IS NOT WHERE THE CLOCKS ARE READ.
 *
 * `gather.ts` deliberately loads work days for the whole calendar months the cutoff straddles —
 * the 104-hour statutory counter resets on the first, so a run has to see days it does not pay.
 * Which of those days it *pays* is decided later, inside `measureEmployment`, against the
 * employment's own attendance window. That makes "a clock outside the cut-off" a case where the
 * data is present, in the bundle, in front of the code, and must still not reach an amount.
 * A test that simply withholds the row proves nothing about that.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureEmployment } from './lib/measure.ts';
import { PLAIN_CALENDAR } from './lib/settlement.ts';

const WORK_CODE = '00000000-0000-4000-8000-00000000c001';
const REST_CODE = '00000000-0000-4000-8000-00000000c002';

/** 08:30–17:30 with an hour's unpaid break: eight paid hours. */
const SHIFT_CODES = new Map([
	[
		WORK_CODE,
		{
			id: WORK_CODE,
			code: 'D',
			variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 },
			effective_range: { start: '2020-01-01', end: null }
		}
	],
	[
		REST_CODE,
		{
			id: REST_CODE,
			code: 'RD',
			variant: { kind: 'REST' },
			effective_range: { start: '2020-01-01', end: null }
		}
	]
]);

/** Six working days then a rest day, anchored on Monday 5 January 2026. */
const SIX_DAY_WEEK = {
	type: 'PATTERNED',
	anchor_date: '2026-01-05',
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: WORK_CODE },
				{ roster_code_id: REST_CODE }
			]
		}
	]
};

const JURISDICTION = {
	id: 'jur-my',
	code: 'MY',
	currency: 'MYR',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate_divisor: 26,
	ordinary_rate_basis: 'DAYS_PER_MONTH',
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
};

const COMPANY = {
	id: 'co-my',
	name: 'Nihon (MY)',
	jurisdiction_id: 'jur-my',
	pay_cutoff_day: 21,
	pay_day: 28,
	leave_year_start_month: 1,
	overtime_calculation_method: 'STATUTORY_AGGREGATE',
	risk_class: null,
	settlement_policy: null,
	effective_range: { start: '2020-01-01', end: null }
};

const component = (overrides) => ({
	company_id: 'co-my',
	nature: 'EARNING',
	policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
	eligibility: [],
	effective_range: { start: '2020-01-01', end: null },
	...overrides
});

const BASIC = component({
	id: '00000000-0000-4000-8000-00000000p001',
	code: 'BASIC',
	name: 'Basic salary',
	sequence: 10,
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
});

/**
 * The band codes the derived overtime lines carry.
 *
 * There is no pay component behind any of these — the catalogue below holds a salary and an
 * allowance and nothing else. A line's identity is the statutory band that priced it, and these are
 * the six bands the Malaysian ladder further down states.
 */
const OT_ORDINARY = 'OT_ORDINARY_BEYOND_NORMAL_0';
const OT_REST_HALF = 'OT_REST_DAY_FROM_START_OF_DAY_0';
const OT_REST_FULL = 'OT_REST_DAY_FROM_START_OF_DAY_0_5';
const OT_REST_BEYOND = 'OT_REST_DAY_BEYOND_NORMAL_0';
const OT_HOLIDAY = 'OT_PUBLIC_HOLIDAY_FROM_START_OF_DAY_0';
const OT_HOLIDAY_BEYOND = 'OT_PUBLIC_HOLIDAY_BEYOND_NORMAL_0';

const TRANSPORT = component({
	id: '00000000-0000-4000-8000-00000000p008',
	code: 'TRANSPORT',
	name: 'Transport allowance',
	sequence: 50,
	definition: {
		source: 'ENTRY',
		unit: 'MONEY',
		evidence: 'NONE',
		cap: null,
		settlement: 'PAYROLL'
	}
});

// Overtime is deliberately absent: it is not a pay component, and a company cannot put it in its
// catalogue. Every overtime figure below comes out of the ladder and the clocks alone.
const PAY_COMPONENTS = [BASIC, TRANSPORT];

/**
 * The Malaysian ladder as seeded: an ordinary day pays 1.5× beyond the normal day; a rest day pays
 * half a day's wages up to half the normal day and a full day's wages up to it, then 2.0× hourly
 * beyond; a public holiday pays two days' wages then 3.0× hourly.
 */
const OVERTIME_RULES = [
	{
		id: 'rule-ord',
		authority: 'EA 1955 s.60A(1)(a)',
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		id: 'rule-rest-half',
		authority: 'EA 1955 s.60(3)',
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 0.5 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 0.5 }
	},
	{
		id: 'rule-rest-full',
		authority: 'EA 1955 s.60(3)',
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
	},
	{
		id: 'rule-rest-beyond',
		authority: 'EA 1955 s.60(3)(c)',
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		id: 'rule-ph',
		authority: 'EA 1955 s.60D(3)',
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 2 }
	},
	{
		id: 'rule-ph-beyond',
		authority: 'EA 1955 s.60D(3)',
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
];

function configuration(overrides = {}) {
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		contributions: [],
		treatments: new Map(),
		payComponents: PAY_COMPONENTS,
		overtimeRules: OVERTIME_RULES,
		overtimeLimits: [],
		overtimeCoverageRule: null,
		shiftById: SHIFT_CODES,
		holidays: new Map(),
		leaveTypes: [],
		hash: 'test',
		...overrides
	};
}

/** Clocks are recorded at UTC+8, which is what the `+08:00` instants on a work day hold. */
const clock = (date, from, to) => ({
	id: `day-${date}`,
	work_date: date,
	shift_definition_id: null,
	worked_intervals: [{ start: `${date}T${from}:00.000+08:00`, end: `${date}T${to}:00.000+08:00` }],
	break_minutes: 60
});

const terms = (overrides = {}) => ({
	id: 'terms-1',
	employment_id: 'emp-1',
	base_salary: { value: 3451, currency: 'MYR' },
	pay_frequency: 'MONTHLY',
	work_pattern: SIX_DAY_WEEK,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'NON_MANUAL',
	employment_type: 'PERMANENT',
	department: null,
	payroll_group: null,
	effective_range: { start: '2020-01-01', end: null },
	...overrides
});

/** March 2026 under a cutoff of 21: the run pays the month, reading 21 Feb – 20 Mar of attendance. */
const MARCH = { start: '2026-03-01', end: '2026-03-31' };
const MARCH_ATTENDANCE = { start: '2026-02-21', end: '2026-03-20' };

function bundle(overrides = {}) {
	return {
		employment: {
			id: 'emp-1',
			employee_id: 'ee-1',
			employee_number: 'NHPMY0023',
			company_id: 'co-my',
			hire_date: '2021-06-01',
			exit_date: null,
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { id: 'ee-1', date_of_birth: '1992-01-04', gender: 'FEMALE' },
		terms: [terms()],
		statutoryFacts: [],
		obligations: [],
		ledger: [],
		workDays: [],
		serviceMonths: 57,
		age: 34,
		employedDays: MARCH,
		wageDays: MARCH,
		attendance: MARCH_ATTENDANCE,
		arrearsFor: null,
		deferral: null,
		extendedLeaveSettlesInOwnMonth: false,
		...overrides
	};
}

function measure(overrides = {}, configurationOverrides = {}) {
	return measureEmployment({
		bundle: bundle(overrides),
		configuration: configuration(configurationOverrides),
		period: '2026-03',
		salary: MARCH,
		periodsRemaining: 10,
		headcount: 1,
		policy: PLAIN_CALENDAR,
		consumedObligations: new Map()
	});
}

/**
 * Everything measured that carries money, in one list.
 *
 * Base and adjustments, concatenated — the same pair ACCUMULATE and SETTLE read. Which plane an
 * amount is stored in is a fact about what caused it, never about what it is worth, so a test that
 * asked only one of them would pass or fail on the classification rather than on the figure.
 */
const paid = (measured) => [...measured.base, ...measured.adjustments];

/**
 * Amount the named component or overtime band produced, or null when it produced none.
 *
 * `label` rather than `payComponent.code`: an overtime row has no pay component to read a code
 * from, and that is the point of the whole model — its label is the band that priced it.
 *
 * At most one, which is a claim in its own right: a component measures once, and overtime groups by
 * `(work day x band)`, so these single-day fixtures produce one row per band.
 */
const amountOf = (measured, code) => {
	const items = paid(measured).filter((item) => item.label === code);
	assert.ok(items.length <= 1, `${code} produced ${items.length} amounts`);
	return items[0]?.amount ?? null;
};

const lineOf = (measured, code) => paid(measured).find((item) => item.label === code) ?? null;

// ── the rate every figure below is built from ───────────────────────────────────────────────────

test('the ordinary rate is derived from the pattern, not from a payroll convention', () => {
	const measured = measure();
	// 48 contracted hours over six days: 3,451 / 26 / 8.
	assert.equal(measured.ordinaryHourlyRate, 16.59);
	assert.equal(measured.ordinaryDayWage, 132.73);
	assert.equal(measured.currency, 'MYR');
});

// ── the cut-off boundary ────────────────────────────────────────────────────────────────────────

test('a clock past the cut-off is in the bundle, is derived, and is still not paid', () => {
	const inside = clock('2026-03-20', '08:30', '20:30');
	const outside = clock('2026-03-21', '08:30', '20:30');
	const measured = measure({ workDays: [inside, outside] });

	// Both days are derived — the statutory monthly counter has to see the whole calendar month.
	assert.deepEqual(
		measured.overtimeDays.map((day) => [day.date, day.hours]),
		[
			['2026-03-20', 3],
			['2026-03-21', 3]
		]
	);
	assert.equal(measured.calendarMonthOvertimeHours.get('2026-03'), 6);

	// Only the day inside the attendance window is priced onto a payslip line.
	assert.equal(lineOf(measured, OT_ORDINARY).quantity, 3);
	assert.equal(amountOf(measured, OT_ORDINARY), 74.66, '3 h × 1.5 × 16.59');
});

test('the same clock one day earlier is inside the cut-off and is paid', () => {
	// The control for the case above: identical hours, identical everything, one day earlier. If the
	// window check were removed both cases would read 6 h; if it were over-broad both would read 3.
	const measured = measure({
		workDays: [clock('2026-03-20', '08:30', '20:30'), clock('2026-03-19', '08:30', '20:30')]
	});
	assert.equal(lineOf(measured, OT_ORDINARY).quantity, 6);
	assert.equal(amountOf(measured, OT_ORDINARY), 149.31, '6 h × 1.5 × 16.59');
});

test('an overtime adjustment names the statutory band, the work day, and no pay component', () => {
	// The rule being restored, asserted directly: the row carries the band, `payComponent` is null,
	// and `pay_component_id` will therefore be NULL on the stored row. Exactly one of the two.
	const day = clock('2026-03-19', '08:30', '20:30');
	const measured = measure({ workDays: [day] });
	const row = lineOf(measured, OT_ORDINARY);
	assert.equal(row.payComponent, null);
	assert.deepEqual(row.overtimeBand, {
		day_type: 'ORDINARY',
		measure: 'BEYOND_NORMAL',
		band_from: 0,
		excess: false
	});
	assert.equal(row.nature, 'EARNING', 'overtime settles as an earning without a policy to say so');
	// The source is the clock that priced it. `payslip_lines` could not say this — an overtime line
	// named its band and nothing else, and the records behind it sat in another table with no
	// amount on them. It is one row now, and it points at the day.
	assert.deepEqual(row.source, { kind: 'WORK_DAY', id: day.id });

	// And no catalogue row was consulted to produce it: this company's catalogue has two rows.
	assert.deepEqual(paid(measured).map((item) => item.label).toSorted(), ['BASIC', OT_ORDINARY]);
});

test('an obligation settles by the money cut-off, not by the month it is dated in', () => {
	// The arm is columns now: `terms` and `occasion` are enums beside `amount`, not a union nested
	// in jsonb. Nothing here decodes a payload to find out how the money comes due.
	const obligation = (date) => ({
		id: `obligation-${date}`,
		employment_id: 'emp-1',
		pay_component_id: TRANSPORT.id,
		pay_period: null,
		event_date: date,
		amount: 240,
		quantity: null,
		terms: 'ONE_OFF',
		occasion: 'ENTERED',
		note: 'travel',
		effective_range: null,
		instalments: null,
		reverses_obligation_id: null,
		covers_periods: null,
		incurred_on: null
	});

	assert.equal(amountOf(measure({ obligations: [obligation('2026-03-20')] }), 'TRANSPORT'), 240);
	assert.equal(
		amountOf(measure({ obligations: [obligation('2026-03-22')] }), 'TRANSPORT'),
		null,
		'an obligation dated after the 21st is next period’s money and produces nothing here'
	);
	// And the March run does not reach backwards into a period that has already been paid.
	assert.equal(amountOf(measure({ obligations: [obligation('2026-02-10')] }), 'TRANSPORT'), null);
});

test('an obligation produces an adjustment naming it, and nothing produces two', () => {
	// `unique(source, payslip_id)` is what makes this load-bearing. `measureEntry` used to sum every
	// entry on a component into ONE line and link that line to whichever entry happened to be last —
	// a line whose provenance was arbitrary. One obligation, one row, and the row names it.
	const obligation = (id, amount) => ({
		id,
		employment_id: 'emp-1',
		pay_component_id: TRANSPORT.id,
		pay_period: '2026-03',
		event_date: '2026-03-05',
		amount,
		quantity: null,
		terms: 'ONE_OFF',
		occasion: 'ENTERED',
		note: 'travel',
		effective_range: null,
		instalments: null,
		reverses_obligation_id: null,
		covers_periods: null,
		incurred_on: null
	});
	const measured = measure({
		obligations: [obligation('ob-a', 240), obligation('ob-b', 60)]
	});
	const transport = measured.adjustments.filter((row) => row.label === 'TRANSPORT');
	assert.deepEqual(
		transport.map((row) => [row.source.kind, row.source.id, row.amount]),
		[
			['OBLIGATION', 'ob-a', 240],
			['OBLIGATION', 'ob-b', 60]
		]
	);
	// And nothing about them landed in base: an obligation is a record somebody can edit, which is
	// the whole of what makes an amount an adjustment.
	assert.deepEqual(
		measured.base.map((item) => item.label),
		['BASIC']
	);
});

// ── overtime, from a clock to an amount on a named component ────────────────────────────────────

test('a day worked to its scheduled end pays no overtime at all', () => {
	const measured = measure({ workDays: [clock('2026-03-19', '08:30', '17:30')] });
	assert.deepEqual(measured.overtimeDays, []);
	assert.equal(amountOf(measured, OT_ORDINARY), null);
	assert.equal(amountOf(measured, 'BASIC'), 3451);
});

test('overtime crosses into a second band only where the ladder says so', () => {
	// A single open 1.5× band: three hours and six hours differ by exactly three hours of pay, and
	// nothing is rerated at some invented threshold along the way.
	const three = measure({ workDays: [clock('2026-03-19', '08:30', '20:30')] });
	const six = measure({ workDays: [clock('2026-03-19', '08:30', '23:30')] });
	assert.equal(amountOf(three, OT_ORDINARY), 74.66);
	assert.equal(amountOf(six, OT_ORDINARY), 149.31);
	assert.equal(lineOf(six, OT_ORDINARY).rate, 16.59);
});

test('a rest day pays a day’s wages, and only the hours past the normal day run the ladder', () => {
	// 15 March 2026 is the pattern's rest day. Eight hours is a full normal day: EA s.60(3) pays one
	// day's wages for it, 132.73 — not eight hours at 2.0 × 16.59, which would be 265.44.
	const eight = measure({ workDays: [clock('2026-03-15', '08:30', '17:30')] });
	assert.equal(eight.overtimeDays[0].dayType, 'REST_DAY');
	assert.equal(amountOf(eight, OT_REST_FULL), 132.73);
	assert.equal(amountOf(eight, OT_REST_HALF), null, 'a day’s wages is paid once, at its band');
	assert.equal(amountOf(eight, OT_REST_BEYOND), null);

	// Two hours past the normal day, and only those two, reach the 2.0× hourly band.
	const ten = measure({ workDays: [clock('2026-03-15', '08:30', '19:30')] });
	assert.equal(amountOf(ten, OT_REST_FULL), 132.73);
	assert.equal(amountOf(ten, OT_REST_BEYOND), 66.36, '2 h × 2.0 × 16.59');
	assert.equal(lineOf(ten, OT_REST_BEYOND).quantity, 2);

	// Under half a normal day takes the half-day band instead of the full one.
	const three = measure({ workDays: [clock('2026-03-15', '08:30', '12:30')] });
	assert.equal(amountOf(three, OT_REST_HALF), 66.37, 'half of 132.73, rounded to the cent');
	assert.equal(amountOf(three, OT_REST_FULL), null);
});

test('a public holiday is paid at its own statutory rate, from the holiday calendar', () => {
	// 10 March 2026 is an ordinary working Tuesday until the company calendar says otherwise.
	const holidays = new Map([
		[
			'2026-03-10',
			{
				id: 'hol-1',
				company_id: 'co-my',
				observed_date: '2026-03-10',
				name: 'Nuzul Al-Quran',
				substitutes_date: null
			}
		]
	]);
	const worked = measure({ workDays: [clock('2026-03-10', '08:30', '19:30')] }, { holidays });
	assert.equal(worked.overtimeDays[0].dayType, 'PUBLIC_HOLIDAY');
	assert.equal(amountOf(worked, OT_HOLIDAY), 265.46, 'two days’ wages: 2 × 132.73');
	assert.equal(amountOf(worked, OT_HOLIDAY_BEYOND), 99.54, '2 h × 3.0 × 16.59');
	assert.equal(amountOf(worked, OT_ORDINARY), null, 'a holiday is not an ordinary day');

	// The same clock on the same date, with no holiday declared, is ordinary overtime beyond 17:30.
	const ordinary = measure({ workDays: [clock('2026-03-10', '08:30', '19:30')] });
	assert.equal(amountOf(ordinary, OT_HOLIDAY), null);
	assert.equal(amountOf(ordinary, OT_ORDINARY), 49.77, '2 h × 1.5 × 16.59');
});

// ── proration ───────────────────────────────────────────────────────────────────────────────────

test('a whole month is not prorated', () => {
	assert.equal(amountOf(measure(), 'BASIC'), 3451);
});

test('a mid-month joiner is paid the days they were employed, over the month’s calendar days', () => {
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		employment: { ...bundle().employment, hire_date: '2026-03-16' },
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};
	const measured = measure(joined);
	// 3,451 × 16/31. Sixteen days is 16–31 March inclusive; a divisor of 30 would pay 1,840.53 and a
	// divisor of 26 — the overtime divisor — would pay 2,123.69.
	assert.equal(amountOf(measured, 'BASIC'), 1781.16);

	// Their overtime is priced at the full-month rate, not at their part-month pay: the numerator of
	// the ordinary rate is the contract salary, unprorated.
	assert.equal(measured.ordinaryHourlyRate, 16.59);
	const withOvertime = measure({ ...joined, workDays: [clock('2026-03-19', '08:30', '20:30')] });
	assert.equal(amountOf(withOvertime, OT_ORDINARY), 74.66);
});

test('a mid-month leaver is paid to their last day', () => {
	const measured = measure({
		employedDays: { start: '2026-03-01', end: '2026-03-17' },
		wageDays: { start: '2026-03-01', end: '2026-03-17' },
		employment: { ...bundle().employment, exit_date: '2026-03-17' },
		terms: [terms({ effective_range: { start: '2020-01-01', end: '2026-03-17' } })]
	});
	// 3,451 × 17/31. The seventeen days are 1–17 March inclusive: an exclusive end would pay 16.
	assert.equal(amountOf(measured, 'BASIC'), 1892.48);
});

test('a joiner and a leaver in the same month never add up to more than the month', () => {
	const leaver = measure({
		employedDays: { start: '2026-03-01', end: '2026-03-15' },
		wageDays: { start: '2026-03-01', end: '2026-03-15' },
		terms: [terms({ effective_range: { start: '2020-01-01', end: '2026-03-15' } })]
	});
	const joiner = measure({
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	});
	assert.equal(amountOf(leaver, 'BASIC'), 1669.84);
	assert.equal(amountOf(joiner, 'BASIC'), 1781.16);
	assert.equal(
		Math.round((amountOf(leaver, 'BASIC') + amountOf(joiner, 'BASIC')) * 100) / 100,
		3451,
		'the two halves of one seat cost exactly one salary'
	);
});

test('a mid-month raise is two recorded proration segments, summing to one month', () => {
	const measured = measure({
		terms: [
			terms({
				id: 'terms-old',
				base_salary: { value: 4000, currency: 'MYR' },
				effective_range: { start: '2020-01-01', end: '2026-03-15' }
			}),
			terms({
				id: 'terms-new',
				base_salary: { value: 4600, currency: 'MYR' },
				effective_range: { start: '2026-03-16', end: null }
			})
		]
	});
	// 4,000 × 15/31 + 4,600 × 16/31. Paying the closing wage for the whole month would give 4,600
	// and paying the opening one would give 4,000; the month is worth neither.
	assert.equal(amountOf(measured, 'BASIC'), 4309.68);
	// And the rate the raise leaves behind is the closing wage's, not a blend of the two.
	assert.equal(measured.ordinaryHourlyRate, 22.12, '4,600 / 26 / 8');

	/**
	 * The whole point of the restructure, asserted.
	 *
	 * The old shape summed the two fractions into one line and threw the working away: 4,309.68 with
	 * nothing on the payslip saying which terms rows produced it, over how many days, against which
	 * divisor. Every input is stored beside its result now, so the figure stays re-readable years
	 * after the jurisdiction changed how it prorates.
	 */
	assert.deepEqual(measured.proration, [
		{
			term_id: 'terms-old',
			from: '2026-03-01',
			to: '2026-03-15',
			basis: { by: 'CALENDAR_DAYS' },
			days: 15,
			denominator: 31,
			contract_amount: 4000,
			prorated_amount: 1935.48
		},
		{
			term_id: 'terms-new',
			from: '2026-03-16',
			to: '2026-03-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 16,
			denominator: 31,
			// 2,374.19 on its own. The month rounds once, to 4,309.68, and the residue lands here
			// rather than being left as a cent nobody can account for.
			contract_amount: 4600,
			prorated_amount: 2374.2
		}
	]);
	// One base entry, not two. Proration is the working; base is what was settled, and a reader
	// summing base must never have to know whether segments happen to exist.
	assert.deepEqual(
		measured.base.map((item) => [item.entry.pay_component_id, item.entry.amount]),
		[[BASIC.id, 4309.68]]
	);
	// The invariant `payslip_proration` states: the segments sum, exactly.
	assert.equal(
		Math.round(
			measured.proration.reduce((total, segment) => total + segment.prorated_amount, 0) * 100
		) / 100,
		amountOf(measured, 'BASIC')
	);
});

test('a whole month is still one recorded segment, not an absence of one', () => {
	// "31 of 31 days at the contract" is a statement. A payslip that carries it only sometimes is a
	// payslip whose reader has to know when — so the segment is always written.
	const measured = measure();
	assert.deepEqual(measured.proration, [
		{
			term_id: 'terms-1',
			from: '2026-03-01',
			to: '2026-03-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 31,
			denominator: 31,
			contract_amount: 3451,
			prorated_amount: 3451
		}
	]);
});

test('a standing allowance prorates with the employment; a one-off does not', () => {
	// `cadence: 'PAY_PERIOD'` is gone with the union: it was a literal with exactly one value, which
	// is not a fact but a constant written into every row. A RECURRING obligation is its range.
	const standing = {
		id: 'obligation-recurring',
		employment_id: 'emp-1',
		pay_component_id: TRANSPORT.id,
		pay_period: null,
		event_date: '2026-03-01',
		amount: 310,
		quantity: null,
		terms: 'RECURRING',
		occasion: null,
		effective_range: { start: '2020-01-01', end: null },
		instalments: null,
		note: null,
		reverses_obligation_id: null,
		covers_periods: null,
		incurred_on: null
	};
	const oneOff = {
		...standing,
		id: 'obligation-once',
		terms: 'ONE_OFF',
		occasion: 'ENTERED',
		effective_range: null,
		note: 'x'
	};
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};

	assert.equal(amountOf(measure({ obligations: [standing] }), 'TRANSPORT'), 310);
	assert.equal(
		amountOf(measure({ ...joined, obligations: [standing] }), 'TRANSPORT'),
		160,
		'310 × 16/31'
	);
	assert.equal(
		amountOf(measure({ ...joined, obligations: [oneOff] }), 'TRANSPORT'),
		310,
		'a one-off is a whole amount for a moment in time and is never divided by a month'
	);
});
