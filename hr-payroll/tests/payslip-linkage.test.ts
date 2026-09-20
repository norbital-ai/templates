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
 * in Malaysia, so the ordinary rate is 3,451 / 26 / 8 = 16.591346… and a day's wages is 132.730769…. Rates retain precision until each completed award is rounded.
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
import { claimRequest } from '../src/lib/payroll/money.ts';
import { decodeNumber } from '@norbital-ai/std/json';
import { workPayItems } from '../src/lib/payroll/work-lines.ts';

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
	days: [
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: WORK_CODE },
		{ roster_code_id: REST_CODE }
	]
};

const WORK = {
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_divisor_days: '26.0',
	overtime_when: '',
	bands: [],
	limits: [],
	wages: { by_region: {} },
	breaks: [],
	holiday_rest_precedence: 'REST_DAY'
};

const JURISDICTION = {
	id: 'jur-my',
	code: 'MY',
	jurisdiction_code: 'MY',
	name: 'Malaysia',
	payroll: {
		currency: 'MYR',
		timezone: 'Asia/Kuala_Lumpur',
		tax_year_start_month: 1,
		allowance_npl_prorates: false
	},
	sources: { urls: [] },
	work_rules: WORK,
	effective_range: { start: '2020-01-01', end: null },
	sealed_at: '2020-01-01T00:00:00.000Z',
	voided_at: null
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
	destination: 'PAY',
	direction: 'ADD',
	eligibility: '',
	bands: [],
	...overrides
});

const BASIC = component({
	id: '00000000-0000-4000-8000-00000000p001',
	family: 'WORK',
	output: 'salary',
	code: 'BASIC',
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
});

/**
 * The band labels the derived overtime lines carry: one line per OT class, its
 * identity the pair (line, label). The six seeded ladder steps below produce these classes.
 */
const OT_ORDINARY = '1.5';
const OT_REST_HALF = '1.0';
const OT_REST_FULL = '1.0';
const OT_REST_BEYOND = '2.0';
const OT_HOLIDAY = '2.0';
const OT_HOLIDAY_BEYOND = '3.0';

const TRANSPORT = component({
	id: '00000000-0000-4000-8000-00000000p008',
	family: 'ALLOWANCE',
	code: 'TRANSPORT',
	bands: [{ when: '', amount: 'entry.amount', limit: null }],
	definition: { source: 'ENTRY' }
});

// Work states its bands on the settings root; each (line, label) pair is a pay item of its own.
const workComponent = (line, label) =>
	component({
		id: `work-${line.toLowerCase()}-${label}`,
		family: 'WORK',
		output: `${line}:${label}`,
		code: line,
		definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
	});

const COMPONENT_CATALOGUE = [BASIC, TRANSPORT];

/**
 * The Malaysian ladder as seeded: an ordinary day pays 1.5× beyond the normal day; a rest day pays
 * half a day's wages up to half the normal day and a full day's wages up to it, then 2.0× hourly
 * beyond; a public holiday pays two days' wages then 3.0× hourly.
 */
const OVERTIME_BANDS = [
	{
		label: '1.5',
		when: 'day_type == "ORDINARY"',
		take_hours: 'hours_beyond_normal',
		price_amount: 'hours_beyond_normal * ordinary_hour * 1.5'
	},
	{
		label: '1.0',
		when: 'day_type == "REST_DAY" && hours_from_start_fraction < 0.5',
		take_hours: 'normal_hours',
		price_amount: 'day_wage * 0.5'
	},
	{
		label: '1.0',
		when: 'day_type == "REST_DAY" && hours_from_start_fraction >= 0.5',
		take_hours: 'normal_hours',
		price_amount: 'day_wage * 1.0'
	},
	{
		label: '2.0',
		when: 'day_type == "REST_DAY"',
		take_hours: 'hours_beyond_normal',
		price_amount: 'hours_beyond_normal * ordinary_hour * 2.0'
	},
	{
		label: '2.0',
		when: 'day_type == "PUBLIC_HOLIDAY"',
		take_hours: 'normal_hours',
		price_amount: 'day_wage * 2.0'
	},
	{
		label: '3.0',
		when: 'day_type == "PUBLIC_HOLIDAY"',
		take_hours: 'hours_beyond_normal',
		price_amount: 'hours_beyond_normal * ordinary_hour * 3.0'
	}
];

function workRules(bands = []) {
	return {
		...WORK,
		settings_id: 'jur-my',
		jurisdiction_code: 'MY',
		bands
	};
}

function configuration(overrides = {}) {
	const bands = overrides.bands ?? OVERTIME_BANDS;
	const catalogueComponents = overrides.catalogueComponents ?? COMPONENT_CATALOGUE;
	const work = {
		...workRules(bands),
		...overrides.work
	};
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		allowanceCodeById: new Map(),
		work,
		holidayRestPrecedence: overrides.holidayRestPrecedence ?? WORK.holiday_rest_precedence,
		contributions: [],
		catalogueComponents: [
			...catalogueComponents,
			...workPayItems(work).filter(
				(row) =>
					(row.output ?? '').includes(':') &&
					!catalogueComponents.some((existing) => existing.output === row.output)
			)
		],
		limits: WORK.limits,
		breaks: WORK.breaks,
		nightPremium: overrides.nightPremium ?? null,
		overtimeCoverageRule: null,
		shiftById: SHIFT_CODES,
		patternById: new Map([
			[
				'pattern-1',
				{
					id: 'pattern-1',
					code: 'SIX-DAY',
					pattern: SIX_DAY_WEEK,
					effective_range: { start: '2026-01-05', end: null }
				}
			]
		]),
		holidays: overrides.holidays ?? new Map(),
		holidaySnapshots: [],
		holidayInputs: [],
		catalogueLeaves: [],
		hash: 'test'
	};
}

/**
 * Clocks are recorded at UTC+8, which is what the `+08:00` instants on a work day hold. The hour's
 * lunch is a gap between two punches, never a stored figure: the engine derives the break from the
 * shift's grant less that gap, so a rest day (no grant) and a working day (an hour granted, an hour
 * already taken) both price the hours actually clocked.
 */
const clock = (date, from, to) => {
	const plus = (time, minutes) => {
		const [hours, mins] = time.split(':').map(Number);
		const total = hours * 60 + mins + minutes;
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	};
	return {
		id: `day-${date}`,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [
			{ start: `${date}T${from}:00.000+08:00`, end: `${date}T${plus(from, 90)}:00.000+08:00` },
			{ start: `${date}T${plus(from, 150)}:00.000+08:00`, end: `${date}T${to}:00.000+08:00` }
		]
	};
};

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
		wagePeriods: [],
		leave: { entries: [], catalogues: [], captures: [], deductionEligibility: {} },
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
			assert.equal(request.catalogue_id, TRANSPORT.id);
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
		yearEarned: new Map()
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
	assert.equal(measured.ordinaryHourlyRate, 3451 / 26 / 8);
	assert.equal(measured.ordinaryDayWage, 3451 / 26);
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
	assert.equal(amountOf(measured, OT_ORDINARY), 74.66, '3 h × 1.5 × (3451 / 26 / 8)');
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
	assert.equal(row.catalogueComponent.output, 'OVERTIME:1.5');
	// The band the row was priced by, as the rule key the payslip stores: line:label.
	assert.equal(row.statutoryRuleKey, 'OVERTIME:1.5');
	assert.equal(row.bucket, 'EARNING', 'overtime settles as an earning without a policy to say so');
	// The source is the clock that priced it — an overtime line
	// named its band and nothing else, and the records behind it sat in another table with no
	// amount on them. It is one row now, and it points at the day.
	assert.deepEqual(row.input, { family: 'WORK_DAY', id: day.id });

	// Stored Work output metadata produces salary and this measured overtime band.
	assert.deepEqual(
		paid(measured)
			.map((item) => item.label)
			.toSorted(),
		[OT_ORDINARY, 'BASIC']
	);
});

test('an entry settles by the money cut-off, not by the month it is dated in', () => {
	// Nothing here decodes a payload to find out how the money comes due: each family states the
	// day its economics belong to in its own column, and the cutoff reads the one answer the
	// builder derived from it.
	const entry = (date) =>
		claimRequest({
			id: `entry-${date}`,
			employment_id: 'emp-1',
			catalogue_id: TRANSPORT.id,
			pay_period: null,
			incurred_on: date,
			amount: 240,
			description: 'travel'
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
		claimRequest({
			id,
			employment_id: 'emp-1',
			catalogue_id: TRANSPORT.id,
			pay_period: '2026-03',
			incurred_on: '2026-03-05',
			amount,
			description: 'travel'
		});
	const measured = measure({
		payRequests: [entry('en-a', 240), entry('en-b', 60)]
	});
	const transport = measured.adjustments.filter((row) => row.label === 'TRANSPORT');
	assert.deepEqual(
		transport.map((row) => [row.input.family, row.input.id, row.amount]),
		[
			['CLAIM', 'en-a', 240],
			['CLAIM', 'en-b', 60]
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
	assert.equal(amountOf(six, OT_ORDINARY), 149.32);
	// The row's `rate` is the band's own average over its slice; the ladder's base hour is the
	// component's, not the line's.
	assert.equal(lineOf(six, OT_ORDINARY).quantity, 6);
});

test('a rest day pays a day’s wages, and only the hours past the normal day run the ladder', () => {
	// 15 March 2026 is the pattern's rest day. Eight hours is a full normal day: EA s.60(3) pays one
	// day's wages for it, 132.73 — not eight hours at 2.0 × (3451 / 26 / 8), which would be 265.44.
	const eight = measure({ workDays: [clock('2026-03-15', '08:30', '17:30')] });
	assert.equal(eight.overtimeDays[0].dayType, 'REST_DAY');
	assert.equal(amountOf(eight, OT_REST_FULL), 132.73, 'a day’s wages is paid once, at its band');
	assert.equal(amountOf(eight, OT_REST_BEYOND), null);

	// Two hours past the normal day, and only those two, reach the 2.0× hourly band.
	const ten = measure({ workDays: [clock('2026-03-15', '08:30', '19:30')] });
	assert.equal(amountOf(ten, OT_REST_FULL), 132.73);
	assert.equal(amountOf(ten, OT_REST_BEYOND), 66.37, '2 h × 2.0 × (3451 / 26 / 8)');
	assert.equal(lineOf(ten, OT_REST_BEYOND).quantity, 2);

	// Under half a normal day takes the half-day band instead of the full one.
	const three = measure({ workDays: [clock('2026-03-15', '08:30', '12:30')] });
	assert.equal(amountOf(three, OT_REST_HALF), 66.37, 'half of 132.73, rounded to the cent');
	assert.equal(
		three.adjustments.filter((row) => row.label === OT_REST_HALF).length,
		1,
		'under half a day takes the half-day band and not both'
	);
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
	assert.equal(amountOf(worked, OT_HOLIDAY_BEYOND), 99.55, '2 h × 3.0 × (3451 / 26 / 8)');
	assert.equal(amountOf(worked, OT_ORDINARY), null, 'a holiday is not an ordinary day');

	// The same clock on the same date, with no holiday declared, is ordinary overtime beyond 17:30.
	const ordinary = measure({ workDays: [clock('2026-03-10', '08:30', '19:30')] });
	assert.equal(amountOf(ordinary, OT_HOLIDAY), null);
	assert.equal(amountOf(ordinary, OT_ORDINARY), 49.77, '2 h × 1.5 × (3451 / 26 / 8)');
});

test('a SPECIAL holiday is its own day type, priced on the SPECIAL_HOLIDAY ladder', () => {
	const holidays = new Map([
		[
			'2026-03-10',
			{
				id: 'hol-s',
				jurisdiction_code: 'MY',
				date: '2026-03-10',
				name: 'Special',
				kind: 'SPECIAL_HOLIDAY'
			}
		]
	]);
	const rules = [
		...OVERTIME_BANDS,
		{
			label: '1.3',
			when: 'day_type == "SPECIAL_HOLIDAY"',
			take_hours: 'overtime_hours',
			price_amount: 'overtime_hours * ordinary_hour * 1.3'
		}
	];
	const worked = measure(
		{ workDays: [clock('2026-03-10', '08:30', '19:30')] },
		{ holidays, bands: rules }
	);
	assert.equal(worked.overtimeDays[0].dayType, 'SPECIAL_HOLIDAY');
	// Ten worked hours, all overtime on a holiday: 10 × 1.3 × (3451 / 26 / 8), and nothing on the public ladder.
	assert.equal(amountOf(worked, '1.3'), 215.69);
	assert.equal(amountOf(worked, OT_HOLIDAY), null);
	// A regime that states no SPECIAL_HOLIDAY ladder prices the day at nothing on the overtime
	// lines; the wage itself still settles.
	const unpriced = measure({ workDays: [clock('2026-03-10', '08:30', '19:30')] }, { holidays });
	assert.deepEqual(unpriced.adjustments, []);
	assert.equal(amountOf(unpriced, 'BASIC'), 3451);
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
				kind: 'PUBLIC_HOLIDAY'
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

test('a holiday the calendar substitutes itself is observed once, not twice', () => {
	// The gazette usually publishes the substitute as its own dated row naming the day it comes
	// from — Malaysia, Singapore, Taiwan and Vietnam all seed one per rest-day holiday, fourteen
	// rows across the bank. Carrying the holiday forward as well observed it twice: the seeded
	// Monday priced as a holiday from its own row without consuming the carry, and the carry then
	// landed on Tuesday. Three extra paid holidays a year in Singapore alone.
	const holidays = new Map([
		[
			'2026-03-15',
			{
				id: 'hol-sun',
				jurisdiction_code: 'MY',
				date: '2026-03-15',
				name: 'Sunday festival',
				kind: 'PUBLIC_HOLIDAY'
			}
		],
		[
			'2026-03-16',
			{
				id: 'hol-sub',
				jurisdiction_code: 'MY',
				date: '2026-03-16',
				name: 'Sunday festival (substitute)',
				kind: 'SUBSTITUTE',
				replaces: '2026-03-15'
			}
		]
	]);
	const measured = measure(
		{
			workDays: [
				clock('2026-03-15', '08:30', '12:30'),
				clock('2026-03-16', '08:30', '19:30'),
				clock('2026-03-17', '08:30', '19:30')
			]
		},
		{ holidays, holidayRestPrecedence: 'SUBSTITUTE' }
	);
	assert.deepEqual(
		measured.overtimeDays.map((day) => [day.date, day.dayType]),
		[
			['2026-03-15', 'REST_DAY'],
			['2026-03-16', 'PUBLIC_HOLIDAY'],
			['2026-03-17', 'ORDINARY']
		],
		'Tuesday is an ordinary day: the calendar already said where the Sunday is observed'
	);
});

test('the night premium adds a share of the hourly rate to hours inside the window, per day', () => {
	const night = component({
		id: 'work-night',
		family: 'WORK',
		output: 'night',
		code: 'NIGHT_PREMIUM',
		definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
	});
	const nightPremium = { from: '22:00', to: '06:00', ordinary_add: 10, overtime_add: 20 };
	const configurationWithNight = {
		catalogueComponents: [...COMPONENT_CATALOGUE, night],
		nightPremium
	};
	// An ordinary day clocked 14:30–02:00: ten and a half hours net of the break, two and a half
	// beyond the normal eight, and four of the clocked hours inside the window.
	const late = measure(
		{
			workDays: [
				{
					...clock('2026-03-10', '14:30', '23:59'),
					worked_intervals: [
						{ start: '2026-03-10T14:30:00.000+08:00', end: '2026-03-11T02:00:00.000+08:00' }
					]
				}
			]
		},
		configurationWithNight
	);
	const line = paid(late).find((item) => item.label === 'NIGHT_PREMIUM');
	assert.equal(line?.amount, 13.27, '4 h × 20% × (3451 / 26 / 8)');
	assert.equal(line?.quantity, 4);
	assert.equal(line?.catalogueComponent.output, 'night');
	assert.equal(line?.input.id, 'day-2026-03-10');
	assert.equal(
		amountOf(late, OT_ORDINARY),
		62.22,
		'2.5 h × 1.5 × (3451 / 26 / 8): overtime itself is unchanged'
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
		employment: {
			...bundle().employment,
			effective_range: { start: '2026-03-16', end: null }
		},
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};
	const measured = measure(joined);
	// 3,451 × 16/31. Sixteen days is 16–31 March inclusive; a divisor of 30 would pay 1,840.53 and a
	// divisor of 26 — the overtime divisor — would pay 2,123.69.
	assert.equal(amountOf(measured, 'BASIC'), 1781.16);

	// Their overtime is priced at the full-month rate, not at their part-month pay: the numerator of
	// the ordinary rate is the contract salary, unprorated.
	assert.equal(measured.ordinaryHourlyRate, 3451 / 26 / 8);
	const withOvertime = measure({ ...joined, workDays: [clock('2026-03-19', '08:30', '20:30')] });
	assert.equal(amountOf(withOvertime, OT_ORDINARY), 74.66);
});

test('a FIXED_DAYS basis pays the days employed over the divisor the Work states', () => {
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		employment: {
			...bundle().employment,
			effective_range: { start: '2026-03-16', end: null }
		},
		terms: [terms({ effective_range: { start: '2026-03-16', end: null } })]
	};
	const measured = measure(joined, {
		work: {
			...JURISDICTION,
			jurisdiction_code: JURISDICTION.code,
			proration: { by: 'FIXED_DAYS', days: 30 }
		}
	});
	// A fixed divisor is a count of WORKING days — the DOLE 261/12 = 21.75, the EA's 26 — so its
	// numerator counts working days too, and never calendar ones. 16–31 March holds fourteen of
	// this person's six-day week: 3,451 × 14/30 = 1,610.4666…, to the cent. The same span over
	// March's own thirty-one calendar days pays 1,781.16, so the divisor is the Work's and not the
	// month's; sixteen calendar days over the same thirty would pay 1,840.53, mixing the two bases.
	assert.equal(amountOf(measured, 'BASIC'), 1610.47);
	assert.deepEqual(
		measured.proration.map((segment) => [
			segment.basis.by,
			segment.days,
			segment.denominator,
			segment.prorated_amount
		]),
		[['FIXED_DAYS', 14, 30, 1610.47]],
		'the segment records the divisor it was taken over, not the month it fell in'
	);
});

test('a part period on a FIXED_DAYS basis never out-pays a whole one', () => {
	// The Philippine factor is 21.75 — 261 working days over twelve months, a five-day week — and
	// the same jurisdiction rosters six-day patterns, so a month holds more working days than the
	// factor counts. 6–31 March is twenty-two of this person's working days against a divisor of
	// 21.75: uncounted, that is 22/21.75 and pays 3,490.66, more than the 3,451 someone present
	// for the whole month earns. The days are capped at the divisor, so the segment says so too.
	const measured = measure(
		{
			employedDays: { start: '2026-03-06', end: '2026-03-31' },
			wageDays: { start: '2026-03-06', end: '2026-03-31' },
			employment: {
				...bundle().employment,
				effective_range: { start: '2026-03-06', end: null }
			},
			terms: [terms({ effective_range: { start: '2026-03-06', end: null } })]
		},
		{
			work: {
				...JURISDICTION,
				jurisdiction_code: JURISDICTION.code,
				proration: { by: 'FIXED_DAYS', days: 21.75 }
			}
		}
	);
	assert.equal(amountOf(measured, 'BASIC'), 3451);
	assert.deepEqual(
		measured.proration.map((segment) => [segment.days, segment.denominator]),
		[[21.75, 21.75]]
	);
});

test('a whole month on a FIXED_DAYS basis pays the whole salary, whatever the divisor', () => {
	// The other half of the rule: a monthly-paid employee present all month earns the monthly rate,
	// so a whole period prorates to exactly one however far the month's working days sit from the
	// factor. March 2026 holds twenty-six six-day-week working days against a divisor of thirty;
	// counting them into it would pay 26/30 of the salary, and counting calendar days 31/30.
	const measured = measure(
		{},
		{
			work: {
				...JURISDICTION,
				jurisdiction_code: JURISDICTION.code,
				proration: { by: 'FIXED_DAYS', days: 30 }
			}
		}
	);
	assert.equal(amountOf(measured, 'BASIC'), 3451);
	assert.deepEqual(
		measured.proration.map((segment) => [segment.days, segment.denominator]),
		[[30, 30]]
	);
});

test('a mid-month leaver is paid to their last day', () => {
	const measured = measure({
		employedDays: { start: '2026-03-01', end: '2026-03-17' },
		wageDays: { start: '2026-03-01', end: '2026-03-17' },
		employment: {
			...bundle().employment,
			effective_range: { start: '2021-06-01', end: '2026-03-17' }
		},
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
	assert.equal(measured.ordinaryHourlyRate, 4600 / 26 / 8, '4,600 / 26 / 8');

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
			component_code: 'BASIC',
			term_key: 'PERMANENT @ 2020-01-01 · 4000.00',
			from: '2026-03-01',
			to: '2026-03-15',
			basis: { by: 'CALENDAR_DAYS' },
			days: 15,
			denominator: 31,
			unpaid_days: 0,
			contract_amount: 4000,
			prorated_amount: 1935.48
		},
		{
			component_code: 'BASIC',
			term_key: 'PERMANENT @ 2026-03-16 · 4600.00',
			from: '2026-03-16',
			to: '2026-03-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 16,
			denominator: 31,
			unpaid_days: 0,
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
			component_code: 'BASIC',
			term_key: 'PERMANENT @ 2023-02-24 · 1927.00',
			from: '2026-01-01',
			to: '2026-01-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 31,
			denominator: 31,
			unpaid_days: 0,
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
			component_code: 'BASIC',
			term_key: 'PERMANENT @ 2020-01-01 · 3451.00',
			from: '2026-03-01',
			to: '2026-03-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 31,
			denominator: 31,
			unpaid_days: 0,
			contract_amount: 3451,
			prorated_amount: 3451
		}
	]);
});

test('an allowance on the contract prorates with the employment; a claim does not', () => {
	// The contract's allowance pays every period, on the same basis as basic salary; a claim is
	// a whole amount for a moment in time and no other arm prorates at all.
	const listed = { allowances: [{ catalogue_id: TRANSPORT.id, amount: 310 }] };
	const oneOff = claimRequest({
		id: 'entry-once',
		employment_id: 'emp-1',
		catalogue_id: TRANSPORT.id,
		pay_period: null,
		amount: 310,
		incurred_on: '2026-03-01',
		description: 'x'
	});
	const joined = {
		employedDays: { start: '2026-03-16', end: '2026-03-31' },
		wageDays: { start: '2026-03-16', end: '2026-03-31' },
		terms: [terms({ ...listed, effective_range: { start: '2026-03-16', end: null } })]
	};

	assert.equal(amountOf(measure({ terms: [terms(listed)] }), 'TRANSPORT'), 310);
	assert.equal(amountOf(measure({ ...joined }), 'TRANSPORT'), 160, '310 × 16/31');
	assert.deepEqual(
		paid(measure({ ...joined, payRequests: [oneOff] }))
			.filter((item) => item.label === 'TRANSPORT')
			.map((item) => item.amount),
		[160, 310],
		'the claim is whole beside the prorated allowance'
	);
});
