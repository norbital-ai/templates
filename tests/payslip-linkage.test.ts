// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run consumes components, entries, repayments and clocks, and produces the shapes a
 * payslip stores.
 *
 * The pieces of that sentence are each pinned somewhere already: `overtime-derivation.test.ts`
 * drives `deriveDailyOvertime` and `priceDay`, and `verify-payroll-arithmetic.mjs` drives
 * `prorationFraction`'s divisors, the statutory ladders and which run a period settles in. What
 * nothing drove is the join — `calculateFamilies`, the step that reads a bundle and decides which
 * component receives which money. Everything below is that step, and every figure is the one
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
 * Which of those days it *pays* is decided later, inside `calculateFamilies`, against the
 * employment's own attendance window. That makes "a clock outside the cut-off" a case where the
 * data is present, in the bundle, in front of the code, and must still not reach an amount.
 * A test that simply withholds the row proves nothing about that.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFamilies } from '../src/lib/payroll/families.ts';
import { allowanceRequest, paymentRequest } from '../src/lib/payroll/money.ts';
import { decodeNumber } from '@norbital-ai/std/json';

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
	ordinary_rate: [{ eligibility: '', per: 'DAY', divisor: 26 }],
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
};

const COMPANY = {
	id: 'co-my',
	name: 'Public Fixture Co',
	settings_code: 'MY',
	pay_cutoff_day: 21,
	risk_class: null,
	effective_range: { start: '2020-01-01', end: null }
};

const component = (overrides) => ({
	settings_id: 'jur-my',
	nature: 'EARNING',
	contribution_treatments: {},
	eligibility: '',
	...overrides
});

const BASIC = component({
	id: '00000000-0000-4000-8000-00000000p001',
	family: 'WORK',
	output: 'salary',
	code: 'BASIC',
	name: 'Basic salary',
	sequence: 10,
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
});

/**
 * The band codes the derived overtime lines carry.
 *
 * There is no component behind any of these — the catalogue below holds a salary and an
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
	settlement: 'PAYROLL',
	definition: { source: 'ENTRY', cap: null }
});

// Work outputs carry their own treatment metadata alongside band provenance.
const COMPONENT_CATALOGUE = [
	BASIC,
	TRANSPORT,
	...['overtime', 'overtime_excess'].map((output) =>
		component({
			id: `work-${output}`,
			family: 'WORK',
			output,
			code: output.toUpperCase(),
			sequence: 20,
			definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
		})
	)
];

/**
 * The Malaysian ladder as seeded: an ordinary day pays 1.5× beyond the normal day; a rest day pays
 * half a day's wages up to half the normal day and a full day's wages up to it, then 2.0× hourly
 * beyond; a public holiday pays two days' wages then 3.0× hourly.
 */
const OVERTIME_RULES = [
	{
		id: 'rule-ord',
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		id: 'rule-rest-half',
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 0.5 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 0.5 }
	},
	{
		id: 'rule-rest-full',
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
	},
	{
		id: 'rule-rest-beyond',
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		id: 'rule-ph',
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 2 }
	},
	{
		id: 'rule-ph-beyond',
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
];

function configuration(overrides = {}) {
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		work: { ...JURISDICTION, jurisdiction_code: JURISDICTION.code },
		holidayRestPrecedence: 'REST_DAY',
		leaveProfiles: [JURISDICTION],
		contributions: [],
		treatments: new Map(),
		catalogueComponents: COMPONENT_CATALOGUE,
		overtimeRules: OVERTIME_RULES,
		overtimeLimits: [],
		overtimeCoverageRule: null,
		shiftById: SHIFT_CODES,
		patternById: new Map([
			['pattern-1', { id: 'pattern-1', code: 'SIX-DAY', pattern: SIX_DAY_WEEK }]
		]),
		holidays: new Map(),
		catalogueLeaves: [],
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
	shift_pattern_id: 'pattern-1',
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
			employee_number: 'PUBEM0023',
			settings_id: 'jur-my',
			hire_date: '2021-06-01',
			exit_date: null,
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { id: 'ee-1', date_of_birth: '1992-01-04', gender: 'FEMALE' },
		terms: [terms()],
		termsHistory: overrides.terms ?? [terms()],
		children: [],
		payFrequency: 'MONTHLY',
		window: { period: '2026-03', salary: MARCH, attendance: MARCH_ATTENDANCE },
		statutoryFacts: [],
		loans: [],
		loanRepayments: [],
		leave: { entries: [], catalogues: [], captures: [], balances: {}, deductionEligibility: {} },
		workDays: [],
		serviceMonths: 57,
		age: 34,
		employedDays: MARCH,
		wageDays: MARCH,
		attendance: MARCH_ATTENDANCE,
		arrearsFor: null,
		deferral: null,
		...overrides,
		payRequests: (overrides.payRequests ?? []).map((request) => {
			assert.equal(request.component_catalogue_id, TRANSPORT.id);
			return {
				captures: [],
				...request,
				catalogueComponent: { ...TRANSPORT, family: request.family }
			};
		})
	};
}

function measure(overrides = {}, configurationOverrides = {}, extras = {}) {
	return calculateFamilies({
		bundle: bundle(overrides),
		configuration: configuration(configurationOverrides),
		period: extras.period ?? '2026-03',
		salary: extras.salary ?? MARCH,
		periodsRemaining: extras.periodsRemaining ?? 10,
		headcount: 1,
		consumedEntries: extras.consumedEntries ?? new Map(),
		consumedRepayments: extras.consumedRepayments ?? new Map()
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
 * Overtime labels identify the pricing band; catalogueComponent identifies its Work output.
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
	// The control for the case above: identical hours, identical everything, one day earlier. Both
	// days are paid, but each remains its own adjustment because a payslip adjustment names exactly
	// one work day. If the window check were removed there would be a third row; if it were
	// over-broad there would be only one.
	const measured = measure({
		workDays: [clock('2026-03-20', '08:30', '20:30'), clock('2026-03-19', '08:30', '20:30')]
	});
	const overtime = measured.adjustments.filter((row) => row.label === OT_ORDINARY);
	assert.deepEqual(
		overtime.map((row) => [row.input.id, row.quantity, row.amount]),
		[
			['day-2026-03-19', 3, 74.66],
			['day-2026-03-20', 3, 74.66]
		]
	);
	assert.equal(
		overtime.reduce((total, row) => total + decodeNumber(row.quantity), 0),
		6,
		'the two source-specific rows still pay all six hours'
	);
	assert.equal(
		overtime.reduce((total, row) => total + row.amount, 0),
		149.32,
		'each source-specific adjustment rounds its own three-hour amount'
	);
});

test('an overtime adjustment names its Work output, statutory band and work day', () => {
	const day = clock('2026-03-20', '08:30', '20:30');
	const measured = measure({ workDays: [day] });
	const row = lineOf(measured, OT_ORDINARY);
	assert.equal(row.catalogueComponent.family, 'WORK');
	assert.equal(row.catalogueComponent.output, 'overtime');
	// The band the row was priced by, as the rule key the payslip stores — the same code
	// `overtimeBandCode` writes and the workbook reads.
	assert.equal(row.statutoryRuleKey, OT_ORDINARY);
	assert.equal(row.nature, 'EARNING', 'overtime settles as an earning without a policy to say so');
	// The source is the clock that priced it — an overtime line
	// named its band and nothing else, and the records behind it sat in another table with no
	// amount on them. It is one row now, and it points at the day.
	assert.deepEqual(row.input, { family: 'WORK_DAY', id: day.id });

	// Stored Work output metadata produces salary and this measured overtime band.
	assert.deepEqual(
		paid(measured)
			.map((item) => item.label)
			.toSorted(),
		['BASIC', OT_ORDINARY]
	);
});

test('an entry settles by the money cut-off, not by the month it is dated in', () => {
	// Nothing here decodes a payload to find out how the money comes due: each family states the
	// day its economics belong to in its own column, and the cutoff reads the one answer the
	// builder derived from it.
	const entry = (date) =>
		paymentRequest({
			id: `entry-${date}`,
			employment_id: 'emp-1',
			payment_catalogue_id: TRANSPORT.id,
			pay_period: null,
			effective_on: `${date}T00:00:00.000Z`,
			amount: 240,
			reason: 'travel'
		});

	assert.equal(amountOf(measure({ payRequests: [entry('2026-03-20')] }), 'TRANSPORT'), 240);
	assert.equal(
		amountOf(measure({ payRequests: [entry('2026-03-22')] }), 'TRANSPORT'),
		null,
		'an entry dated after the 21st is next period’s money and produces nothing here'
	);
	// An uncaptured late approval remains payable; a standing capture excludes it.
	assert.equal(amountOf(measure({ payRequests: [entry('2026-02-10')] }), 'TRANSPORT'), 240);
	assert.equal(
		amountOf(
			measure({
				payRequests: [
					{
						...entry('2026-02-10'),
						captured: true,
						captures: [{ id: 'prior-capture', period: '2026-02', amount: 240 }]
					}
				]
			}),
			'TRANSPORT'
		),
		null
	);
});

test('an entry produces an adjustment naming it, and nothing produces two', () => {
	// One entry, one adjustment: `measureEntry` measures exactly one captured input, so the
	// arbitrary provenance the old summed line had has nowhere left to be made.
	const entry = (id, amount) =>
		paymentRequest({
			id,
			employment_id: 'emp-1',
			payment_catalogue_id: TRANSPORT.id,
			pay_period: '2026-03',
			effective_on: '2026-03-05T00:00:00.000Z',
			amount,
			reason: 'travel'
		});
	const measured = measure({
		payRequests: [entry('en-a', 240), entry('en-b', 60)]
	});
	const transport = measured.adjustments.filter((row) => row.label === 'TRANSPORT');
	assert.deepEqual(
		transport.map((row) => [row.input.family, row.input.id, row.amount]),
		[
			['PAYMENT', 'en-a', 240],
			['PAYMENT', 'en-b', 60]
		]
	);
	// And nothing about them landed in base: an entry is a record somebody can edit, which is
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
				jurisdiction_code: 'MY',
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

test('a SPECIAL holiday is its own day type, priced on the SPECIAL_HOLIDAY ladder', () => {
	const holidays = new Map([
		[
			'2026-03-10',
			{ id: 'hol-s', jurisdiction_code: 'MY', date: '2026-03-10', name: 'Special', kind: 'SPECIAL' }
		]
	]);
	const rules = [
		...OVERTIME_RULES,
		{
			id: 'rule-special',
			day_type: 'SPECIAL_HOLIDAY',
			band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
			award: { kind: 'HOURLY_MULTIPLE', multiple: 1.3 }
		}
	];
	const worked = measure(
		{ workDays: [clock('2026-03-10', '08:30', '19:30')] },
		{ holidays, overtimeRules: rules }
	);
	assert.equal(worked.overtimeDays[0].dayType, 'SPECIAL_HOLIDAY');
	// Ten worked hours, all overtime on a holiday: 10 × 1.3 × 16.59, and nothing on the public ladder.
	assert.equal(amountOf(worked, 'OT_SPECIAL_HOLIDAY_BEYOND_NORMAL_0'), 215.67);
	assert.equal(amountOf(worked, OT_HOLIDAY), null);
	// A regime that states no SPECIAL_HOLIDAY ladder cannot price the day, and says so.
	assert.throws(
		() => measure({ workDays: [clock('2026-03-10', '08:30', '19:30')] }, { holidays }),
		/no BEYOND_NORMAL overtime rule for a SPECIAL_HOLIDAY/
	);
});

test('SUBSTITUTE precedence keeps the rest day and observes the holiday on the next working day', () => {
	// Sunday 15 March is the pattern's rest day; the holiday falls on it.
	const holidays = new Map([
		[
			'2026-03-15',
			{
				id: 'hol-sun',
				jurisdiction_code: 'MY',
				date: '2026-03-15',
				name: 'Sunday festival',
				kind: 'PUBLIC'
			}
		]
	]);
	const days = [clock('2026-03-15', '08:30', '12:30'), clock('2026-03-16', '08:30', '19:30')];
	const substituted = measure(
		{ workDays: days },
		{ holidays, holidayRestPrecedence: 'SUBSTITUTE' }
	);
	assert.deepEqual(
		substituted.overtimeDays.map((day) => [day.date, day.dayType]),
		[
			['2026-03-15', 'REST_DAY'],
			['2026-03-16', 'PUBLIC_HOLIDAY']
		]
	);
	assert.equal(amountOf(substituted, OT_REST_HALF), 66.37, 'Sunday is still a rest day');
	assert.equal(amountOf(substituted, OT_HOLIDAY), 265.46, 'Monday is the holiday: two days’ wages');
	// The existing two readings are untouched: the rest day wins, or the holiday does, on the Sunday.
	const restWins = measure({ workDays: days }, { holidays, holidayRestPrecedence: 'REST_DAY' });
	assert.deepEqual(
		restWins.overtimeDays.map((day) => day.dayType),
		['REST_DAY', 'ORDINARY']
	);
	const holidayWins = measure(
		{ workDays: days },
		{ holidays, holidayRestPrecedence: 'PUBLIC_HOLIDAY' }
	);
	assert.deepEqual(
		holidayWins.overtimeDays.map((day) => day.dayType),
		['PUBLIC_HOLIDAY', 'ORDINARY']
	);
});

test('the night premium adds a share of the hourly rate to hours inside the window, per day', () => {
	const night = component({
		id: 'work-night',
		family: 'WORK',
		output: 'night',
		code: 'NIGHT_PREMIUM',
		sequence: 22,
		definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
	});
	const nightPremium = { from: '22:00', to: '06:00', ordinary_add: 10, overtime_add: 20 };
	const configurationWithNight = {
		catalogueComponents: [...COMPONENT_CATALOGUE, night],
		nightPremium
	};
	// An ordinary day clocked 20:00–02:00: six overtime hours, four of them inside the window.
	const late = measure(
		{
			workDays: [
				{
					...clock('2026-03-10', '20:00', '23:59'),
					worked_intervals: [
						{ start: '2026-03-10T20:00:00.000+08:00', end: '2026-03-11T02:00:00.000+08:00' }
					],
					break_minutes: 0
				}
			]
		},
		configurationWithNight
	);
	const line = paid(late).find((item) => item.label === 'NIGHT_PREMIUM');
	assert.equal(line?.amount, 13.27, '4 h × 20% × 16.59');
	assert.equal(line?.quantity, 4);
	assert.equal(line?.catalogueComponent.output, 'night');
	assert.equal(line?.input.id, 'day-2026-03-10');
	assert.equal(
		amountOf(late, OT_ORDINARY),
		149.31,
		'6 h × 1.5 × 16.59: overtime itself is unchanged'
	);
	// A day clocked to its shift earns nothing in the window, and no line at all.
	assert.equal(
		amountOf(
			measure({ workDays: [clock('2026-03-10', '08:30', '17:30')] }, configurationWithNight),
			'NIGHT_PREMIUM'
		),
		null
	);
	// Without a window on the regime nothing is priced, whatever the clock says.
	assert.equal(
		amountOf(
			measure(
				{
					workDays: [
						{
							...clock('2026-03-10', '20:00', '23:59'),
							worked_intervals: [
								{ start: '2026-03-10T20:00:00.000+08:00', end: '2026-03-11T02:00:00.000+08:00' }
							]
						}
					]
				},
				{ catalogueComponents: [...COMPONENT_CATALOGUE, night] }
			),
			'NIGHT_PREMIUM'
		),
		null
	);
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

test('a FIXED_DAYS basis pays the days employed over the divisor the Work states', () => {
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		employment: { ...bundle().employment, hire_date: '2026-03-16' },
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};
	const measured = measure(joined, {
		work: {
			...JURISDICTION,
			jurisdiction_code: JURISDICTION.code,
			proration: { by: 'FIXED_DAYS', days: 30 }
		}
	});
	// 3,451 × 16/30 = 1,840.5333…, to the cent. The same sixteen days over March's own thirty-one
	// pay 1,781.16, so the divisor is the Work's and not the month's.
	assert.equal(amountOf(measured, 'BASIC'), 1840.53);
	assert.deepEqual(
		measured.proration.map((segment) => [
			segment.basis.by,
			segment.days,
			segment.denominator,
			segment.prorated_amount
		]),
		[['FIXED_DAYS', 16, 30, 1840.53]],
		'the segment records the divisor it was taken over, not the month it fell in'
	);
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
			// The label snapshot `payslip_proration.term_key` states: title (or employment type),
			// the day the terms range opens, and the contract amount.
			term_key: 'PERMANENT @ 2020-01-01 · 4000.00',
			from: '2026-03-01',
			to: '2026-03-15',
			basis: { by: 'CALENDAR_DAYS' },
			days: 15,
			denominator: 31,
			contract_amount: 4000,
			prorated_amount: 1935.48
		},
		{
			term_key: 'PERMANENT @ 2026-03-16 · 4600.00',
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
	// summing base must never have to know whether segments happen to exist. `payslip_base`
	// carries the frozen component code, not an id.
	assert.deepEqual(
		measured.base.map((item) => [item.entry.component_code, item.entry.amount]),
		[['BASIC', 4309.68]]
	);
	// The invariant `payslip_proration` states: the segments sum, exactly.
	assert.equal(
		Math.round(
			measured.proration.reduce((total, segment) => total + segment.prorated_amount, 0) * 100
		) / 100,
		amountOf(measured, 'BASIC')
	);
});

test('two overlapping terms that both cover a whole month stay one segment and one BASIC', () => {
	const january = { start: '2026-01-01', end: '2026-01-31' };
	const measured = measure(
		{
			employedDays: january,
			wageDays: january,
			attendance: { start: '2025-12-21', end: '2026-01-20' },
			terms: [
				terms({
					id: 'terms-overlap-a',
					base_salary: { value: 1927, currency: 'MYR' },
					effective_range: { start: '2023-02-24', end: null }
				}),
				terms({
					id: 'terms-overlap-b',
					base_salary: { value: 1927, currency: 'MYR' },
					effective_range: { start: '2024-01-01', end: '9999-12-31' }
				})
			]
		},
		{},
		{ period: '2026-01', salary: january }
	);
	assert.deepEqual(
		measured.base.map((item) => [item.entry.component_code, item.entry.amount]),
		[['BASIC', 1927]]
	);
	assert.deepEqual(measured.proration, [
		{
			term_key: 'PERMANENT @ 2023-02-24 · 1927.00',
			from: '2026-01-01',
			to: '2026-01-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 31,
			denominator: 31,
			contract_amount: 1927,
			prorated_amount: 1927
		}
	]);
});

test('derived arrears for this same period is not a second BASIC', () => {
	const measured = measure(
		{
			arrearsFor: {
				period: '2026-03',
				salary: MARCH,
				attendance: MARCH_ATTENDANCE,
				days: MARCH
			}
		},
		{},
		{}
	);
	assert.deepEqual(
		measured.base.map((item) => [item.entry.component_code, item.entry.amount]),
		[['BASIC', 3451]]
	);
	assert.equal(measured.proration.length, 1);
	assert.equal(measured.arrears, null);
});

test('a distinct earlier arrears period still adds its own base line', () => {
	const decemberDays = { start: '2025-12-21', end: '2025-12-31' };
	const measured = measure(
		{
			arrearsFor: {
				period: '2025-12',
				salary: { start: '2025-12-01', end: '2025-12-31' },
				attendance: { start: '2025-11-21', end: '2025-12-20' },
				days: decemberDays
			}
		},
		{},
		{}
	);
	const basics = measured.base.filter((item) => item.label === 'BASIC');
	assert.equal(basics.length, 2);
	assert.ok(
		basics.some((item) => item.amount === 3451),
		'March schedule BASIC remains'
	);
	assert.ok(
		basics.some((item) => item.amount !== 3451),
		'December arrears is a different amount story'
	);
	assert.equal(measured.arrears?.period, '2025-12');
});

test('a whole month is still one recorded segment, not an absence of one', () => {
	// "31 of 31 days at the contract" is a statement. A payslip that carries it only sometimes is a
	// payslip whose reader has to know when — so the segment is always written.
	const measured = measure();
	assert.deepEqual(measured.proration, [
		{
			term_key: 'PERMANENT @ 2020-01-01 · 3451.00',
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
	// The allowance's own effective range is its cadence: an ALLOWANCE event pays every period the
	// range covers, and no other arm prorates at all.
	const standing = allowanceRequest({
		id: 'entry-recurring',
		employment_id: 'emp-1',
		allowance_catalogue_id: TRANSPORT.id,
		pay_period: null,
		amount: 310,
		recurrence: { kind: 'RECURRING', from: '2020-01-01', to: null }
	});
	// A different family, not a different payload on the same one: proration is a property of the
	// collection now, so the contrast the test draws is between two tables rather than two arms.
	const oneOff = paymentRequest({
		id: 'entry-once',
		employment_id: 'emp-1',
		payment_catalogue_id: TRANSPORT.id,
		pay_period: null,
		amount: 310,
		effective_on: '2026-03-01T00:00:00.000Z',
		reason: 'x'
	});
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};

	assert.equal(amountOf(measure({ payRequests: [standing] }), 'TRANSPORT'), 310);
	assert.equal(
		amountOf(measure({ ...joined, payRequests: [standing] }), 'TRANSPORT'),
		160,
		'310 × 16/31'
	);
	assert.equal(
		amountOf(measure({ ...joined, payRequests: [oneOff] }), 'TRANSPORT'),
		310,
		'a one-off is a whole amount for a moment in time and is never divided by a month'
	);
});
