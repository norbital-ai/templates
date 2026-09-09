// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Statutory OT limits reclassify surplus hours as incentive OT. They do not rewrite the clock.
 *
 * Seeds are the sealed MY / VN / ID ladders in `fixtures/statutory-overtime-regimes.ts`. MEASURE
 * is the join: a punch past the ceiling must still capture the work day, pay the retained hours
 * on the statutory band, and emit an `OT_EXCESS_*` line for the rest.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFamilies } from '../src/lib/payroll/families.ts';
import {
	classifyOvertimeByCalendarMonth,
	priceDay
} from '../src/collections/payroll_runs/lib/overtime.ts';
import {
	ID_OVERTIME_LIMITS,
	ID_OVERTIME_RULES,
	MY_OVERTIME_LIMITS,
	MY_OVERTIME_RULES,
	VN_OVERTIME_LIMITS,
	VN_OVERTIME_RULES
} from './fixtures/statutory-overtime-regimes.ts';

const WORK_CODE = '00000000-0000-4000-8000-00000000c001';
const REST_CODE = '00000000-0000-4000-8000-00000000c002';

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

const BASIC = {
	id: '00000000-0000-4000-8000-00000000p001',
	company_id: 'co-1',
	code: 'BASIC',
	name: 'Basic salary',
	sequence: 10,
	nature: 'EARNING',
	is_statutory: false,
	contribution_treatments: {},
	eligibility: '',
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
};

const MARCH = { start: '2026-03-01', end: '2026-03-31' };
const MARCH_ATTENDANCE = { start: '2026-02-21', end: '2026-03-20' };

const clock = (date, from, to) => ({
	id: `day-${date}`,
	work_date: date,
	shift_definition_id: null,
	worked_intervals: [{ start: `${date}T${from}:00.000+08:00`, end: `${date}T${to}:00.000+08:00` }],
	break_minutes: 60
});

const jurisdiction = (overrides) => ({
	id: `jur-${overrides.code}`,
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null },
	...overrides
});

const company = (_jurisdictionId, currency) => ({
	id: `co-${currency}`,
	name: `Test (${currency})`,
	settings_code: currency,
	pay_cutoff_day: 21,
	risk_class: null,
	effective_range: { start: '2020-01-01', end: null }
});

function configuration(options) {
	const jur = options.jurisdiction;
	return {
		company: company(jur.id, jur.currency),
		jurisdiction: jur,
		work: { ...jur, jurisdiction_code: jur.code },
		holidayRestPrecedence: 'REST_DAY',
		leaveProfiles: [jur],
		contributions: [],
		treatments: new Map(),
		catalogueComponents: [
			{ ...BASIC, settings_id: jur.id },
			...['overtime', 'overtime_excess'].map((output) => ({
				...BASIC,
				id: `work-${output}`,
				family: 'WORK',
				output,
				code: output.toUpperCase(),
				definition: { source: 'DERIVED_OVERTIME', unit: 'MONEY' }
			}))
		],
		overtimeRules: options.overtimeRules,
		overtimeLimits: options.overtimeLimits,
		overtimeCoverageRule: null,
		shiftById: SHIFT_CODES,
		patternById: new Map([
			['pattern-1', { id: 'pattern-1', code: 'SIX-DAY', pattern: SIX_DAY_WEEK }]
		]),
		holidays: new Map(),
		catalogueLeaves: [],
		hash: 'test'
	};
}

function bundle(overrides = {}) {
	const result = {
		employment: {
			id: 'emp-1',
			employee_id: 'ee-1',
			employee_number: 'SEED-0001',
			company_id: 'co-1',
			hire_date: '2021-06-01',
			exit_date: null,
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { id: 'ee-1', date_of_birth: '1992-01-04', gender: 'FEMALE' },
		terms: [
			{
				id: 'terms-1',
				employment_id: 'emp-1',
				base_salary: overrides.salary ?? { value: 3451, currency: 'MYR' },
				pay_frequency: 'MONTHLY',
				shift_pattern_id: 'pattern-1',
				statutory_work_category: 'NON_MANUAL',
				work_classification: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				department: null,
				payroll_group: null,
				effective_range: { start: '2020-01-01', end: null }
			}
		],
		statutoryFacts: [],
		payRequests: [],
		loans: [],
		loanRepayments: [],
		leave: { entries: [], catalogues: [], captures: [], balances: {}, deductionEligibility: {} },
		children: [],
		payFrequency: 'MONTHLY',
		window: { period: '2026-03', salary: MARCH, attendance: MARCH_ATTENDANCE },
		workDays: overrides.workDays ?? [],
		serviceMonths: 57,
		age: 34,
		employedDays: MARCH,
		wageDays: MARCH,
		attendance: MARCH_ATTENDANCE,
		arrearsFor: null,
		deferral: null
	};
	return { ...result, termsHistory: result.terms };
}

function measure(world, extras = {}) {
	return calculateFamilies({
		bundle: bundle({ workDays: extras.workDays, salary: extras.salary }),
		configuration: configuration({
			...world,
			overtimeLimits: extras.overtimeLimits ?? world.overtimeLimits
		}),
		period: '2026-03',
		salary: MARCH,
		periodsRemaining: 10,
		headcount: 1,
		consumedEntries: new Map(),
		consumedRepayments: new Map()
	});
}

const paid = (measured) => [...measured.base, ...measured.adjustments];
const lineOf = (measured, label) => paid(measured).find((item) => item.label === label) ?? null;
const amountOf = (measured, label) => lineOf(measured, label)?.amount ?? null;

const ordinaryDay = (hours, totalWorkHours) => ({
	date: '2026-03-10',
	workDayId: 'work-day',
	dayType: 'ORDINARY',
	hours,
	normalHours: 8,
	totalWorkHours
});

const MY = {
	jurisdiction: jurisdiction({
		code: 'MY',
		currency: 'MYR',
		proration: { by: 'CALENDAR_DAYS' },
		ordinary_rate: { per: 'DAY', divisor: 26 }
	}),
	overtimeRules: MY_OVERTIME_RULES,
	overtimeLimits: MY_OVERTIME_LIMITS
};

const VN = {
	jurisdiction: jurisdiction({
		code: 'VN',
		currency: 'VND',
		proration: { by: 'WORKING_DAYS' },
		ordinary_rate: { per: 'DAY', divisor: 26 }
	}),
	overtimeRules: VN_OVERTIME_RULES,
	overtimeLimits: VN_OVERTIME_LIMITS
};

const ID = {
	jurisdiction: jurisdiction({
		code: 'ID',
		currency: 'IDR',
		proration: { by: 'CALENDAR_DAYS' },
		ordinary_rate: { per: 'HOUR', divisor: 173 }
	}),
	overtimeRules: ID_OVERTIME_RULES,
	overtimeLimits: ID_OVERTIME_LIMITS
};

// ── classify: the daily ceilings, from the seeded limits ────────────────────────────────────────

test('Vietnam ordinary OT past four hours is reclassified, never dropped', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [ordinaryDay(6, 14)],
		dailyWorkLimit: null,
		dailyOvertimeHoursLimit: 4,
		monthlyOrdinaryOvertimeLimit: 40
	});
	assert.equal(classified.retainedHours, 4);
	assert.equal(classified.excessHours, 2);
	assert.equal(classified.retainedHours + classified.excessHours, 6);
});

test('Vietnam rest-day OT is not clipped by the ordinary-day four-hour ceiling', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [
			{
				date: '2026-03-15',
				workDayId: 'rest-day',
				dayType: 'REST_DAY',
				hours: 8,
				normalHours: 8,
				totalWorkHours: 8
			}
		],
		dailyWorkLimit: null,
		dailyOvertimeHoursLimit: 4,
		monthlyOrdinaryOvertimeLimit: 40
	});
	assert.equal(classified.retainedHours, 8);
	assert.equal(classified.excessHours, 0);
});

test('Indonesia ordinary OT uses the same four-hour daily overtime ceiling', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [ordinaryDay(5, 13)],
		dailyWorkLimit: null,
		dailyOvertimeHoursLimit: 4,
		monthlyOrdinaryOvertimeLimit: null
	});
	assert.equal(classified.retainedHours, 4);
	assert.equal(classified.excessHours, 1);
});

test('Malaysia still splits on twelve total-work hours, not on overtime hours', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [ordinaryDay(5, 13)],
		dailyWorkLimit: 12,
		dailyOvertimeHoursLimit: null,
		monthlyOrdinaryOvertimeLimit: 104
	});
	assert.equal(classified.retainedHours, 4);
	assert.equal(classified.excessHours, 1);
});

test('a half-hour-short surplus on the overtime-hours ceiling does not move a minute', () => {
	const [classified] = classifyOvertimeByCalendarMonth({
		days: [ordinaryDay(4.3, 12.3)],
		dailyWorkLimit: null,
		dailyOvertimeHoursLimit: 4,
		monthlyOrdinaryOvertimeLimit: null
	});
	assert.equal(classified.excessHours, 0);
	assert.equal(classified.retainedHours, 4.3);
});

// ── priceDay: Indonesia's closed rest-day ladder ────────────────────────────────────────────────

test('Indonesia prices the first ordinary overtime hour at 1.5× and the rest at 2×', () => {
	const priced = priceDay({
		day: ordinaryDay(5, 13),
		rules: ID_OVERTIME_RULES,
		retainedHours: 4
	});
	assert.deepEqual(
		priced.segments.map((segment) => [segment.bandFrom, segment.hours, segment.multiple]),
		[
			[0, 1, 1.5],
			[1, 3, 2]
		]
	);
	assert.deepEqual(
		priced.excess.map((row) => [row.bandFrom, row.hours, row.units]),
		[[1, 1, 2]]
	);
});

test('Indonesia rest-day hours past the last closed band become incentive, not a refusal', () => {
	const priced = priceDay({
		day: {
			date: '2026-03-15',
			workDayId: 'rest-day',
			dayType: 'REST_DAY',
			hours: 13,
			normalHours: 8,
			totalWorkHours: 13
		},
		rules: ID_OVERTIME_RULES,
		retainedHours: 13
	});
	assert.deepEqual(
		priced.segments.map((segment) => [
			segment.measure,
			segment.bandFrom,
			segment.hours,
			segment.multiple
		]),
		[
			['FROM_START_OF_DAY', 0, 8, 2],
			['BEYOND_NORMAL', 0, 1, 3],
			['BEYOND_NORMAL', 1, 3, 4]
		]
	);
	assert.equal(priced.excess.length, 1);
	assert.equal(priced.excess[0].hours, 1);
	assert.equal(priced.excess[0].units, 4);
	assert.equal(priced.excess[0].valuedAt, 'ORDINARY_HOURLY');
});

// ── calculateFamilies: clock → captured work day → OT + incentive ───────────────────────────────

test('Vietnam: five ordinary OT hours pay four at 1.5× and one as incentive, and name the clock', () => {
	const measured = measure(VN, {
		workDays: [clock('2026-03-19', '08:30', '22:30')],
		salary: { value: 26_000_000, currency: 'VND' }
	});
	assert.equal(measured.ordinaryHourlyRate, 125_000);
	assert.equal(measured.overtimeDays[0].hours, 5);
	assert.equal(measured.overtimeDays[0].totalWorkHours, 13);

	const overtime = lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0');
	const incentive = lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0');
	assert.equal(overtime.quantity, 4);
	assert.equal(overtime.amount, 750_000);
	assert.equal(incentive.quantity, 1);
	assert.equal(incentive.amount, 187_500);
	assert.deepEqual(overtime.input, { family: 'WORK_DAY', id: 'day-2026-03-19' });
	assert.deepEqual(incentive.input, { family: 'WORK_DAY', id: 'day-2026-03-19' });
	assert.ok(measured.captured.workDays.includes('day-2026-03-19'));
});

test('Indonesia: five ordinary OT hours keep the 1.5× / 2× bands and move hour five to incentive', () => {
	const measured = measure(ID, {
		workDays: [clock('2026-03-19', '08:30', '22:30')],
		salary: { value: 17_300_000, currency: 'IDR' }
	});
	assert.equal(measured.ordinaryHourlyRate, 100_000);
	assert.equal(amountOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0'), 150_000);
	assert.equal(lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0').quantity, 1);
	assert.equal(amountOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_1'), 600_000);
	assert.equal(lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_1').quantity, 3);
	assert.equal(amountOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_1'), 200_000);
	assert.equal(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_1').quantity, 1);
	assert.deepEqual(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_1').input, {
		family: 'WORK_DAY',
		id: 'day-2026-03-19'
	});
});

test('Indonesia rest day past the priced ladder still captures the day and pays the overflow as incentive', () => {
	const measured = measure(ID, {
		workDays: [clock('2026-03-15', '08:30', '22:30')],
		salary: { value: 17_300_000, currency: 'IDR' }
	});
	assert.equal(measured.overtimeDays[0].dayType, 'REST_DAY');
	assert.equal(measured.overtimeDays[0].hours, 13);
	assert.equal(amountOf(measured, 'OT_REST_DAY_FROM_START_OF_DAY_0'), 1_600_000);
	assert.equal(amountOf(measured, 'OT_REST_DAY_BEYOND_NORMAL_0'), 300_000);
	assert.equal(amountOf(measured, 'OT_REST_DAY_BEYOND_NORMAL_1'), 1_200_000);
	assert.equal(amountOf(measured, 'OT_EXCESS_REST_DAY_BEYOND_NORMAL_1'), 400_000);
	assert.ok(measured.captured.workDays.includes('day-2026-03-15'));
});

test('Malaysia: thirteen clocked hours on an ordinary day keep four OT hours and one incentive hour', () => {
	const measured = measure(MY, {
		workDays: [clock('2026-03-19', '08:30', '22:30')],
		salary: { value: 3451, currency: 'MYR' }
	});
	assert.equal(measured.ordinaryHourlyRate, 16.59);
	assert.equal(measured.overtimeDays[0].totalWorkHours, 13);
	assert.equal(lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0').quantity, 4);
	assert.equal(amountOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0'), 99.54);
	assert.equal(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0').quantity, 1);
	assert.equal(amountOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0'), 24.89);
	assert.deepEqual(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0').input, {
		family: 'WORK_DAY',
		id: 'day-2026-03-19'
	});
});

// ── a lineage's INCENTIVE boundary replaces the statutory classifiers ───────────────────────────

/** Nihon's arrangement on its forked `MY-nihon` lineage: a twelve-hour day less its one-hour break. */
const NIHON_INCENTIVE_LIMIT = {
	period: 'DAY',
	measures: 'TOTAL_WORK_HOURS',
	max_hours: 11,
	on_exceed: 'INCENTIVE'
};
const NIHON = { overtimeLimits: [...MY_OVERTIME_LIMITS, NIHON_INCENTIVE_LIMIT] };
const MY_LIMIT_OPTIONS = {
	dailyWorkLimit: 12,
	dailyOvertimeHoursLimit: null,
	monthlyOrdinaryOvertimeLimit: 104
};

test('an INCENTIVE boundary classifies ordinary-day hours worked past it as incentive, half-hour floored', () => {
	const [day] = classifyOvertimeByCalendarMonth({
		days: [ordinaryDay(5, 13.75)],
		...MY_LIMIT_OPTIONS,
		ordinaryDayIncentiveBoundary: 11
	});
	assert.equal(day.retainedHours, 2.5);
	assert.equal(day.excessHours, 2.5);
});

test('with an INCENTIVE boundary the statutory daily and monthly limits validate but move nothing', () => {
	const days = [
		{ ...ordinaryDay(60, 68), date: '2026-03-10', workDayId: 'a' },
		{ ...ordinaryDay(60, 68), date: '2026-03-11', workDayId: 'b' },
		{ ...ordinaryDay(3, 14), date: '2026-03-14', workDayId: 'c', dayType: 'REST_DAY' }
	];
	const statutory = classifyOvertimeByCalendarMonth({ days, ...MY_LIMIT_OPTIONS });
	assert.ok(
		statutory.some((entry) => entry.excessHours > 0),
		'the statutory limits move hours'
	);
	const company = classifyOvertimeByCalendarMonth({
		days,
		...MY_LIMIT_OPTIONS,
		ordinaryDayIncentiveBoundary: 11
	});
	assert.deepEqual(
		company.map((entry) => [entry.day.workDayId, entry.retainedHours, entry.excessHours]),
		[
			['a', 3, 57],
			['b', 3, 57],
			['c', 3, 0]
		]
	);
});

test('Nihon: thirteen worked hours on a weekday keep three OT hours and pay two as incentive at the same rate', () => {
	const measured = measure(MY, {
		workDays: [clock('2026-03-19', '08:30', '22:30')],
		salary: { value: 3451, currency: 'MYR' },
		...NIHON
	});
	assert.equal(measured.overtimeDays[0].totalWorkHours, 13);
	assert.equal(lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0').quantity, 3);
	assert.equal(amountOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0'), 74.66);
	assert.equal(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0').quantity, 2);
	assert.equal(amountOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0'), 49.77);
});

test('Nihon: an eleven-hour weekday is all statutory overtime, and a rest day is never split by the boundary', () => {
	const weekday = measure(MY, {
		workDays: [clock('2026-03-19', '08:30', '20:30')],
		...NIHON
	});
	assert.equal(lineOf(weekday, 'OT_ORDINARY_BEYOND_NORMAL_0').quantity, 3);
	assert.equal(lineOf(weekday, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0'), null);
	const restDay = measure(MY, {
		workDays: [clock('2026-03-15', '08:30', '22:30')],
		...NIHON
	});
	assert.ok(paid(restDay).some((item) => item.label.startsWith('OT_REST_DAY')));
	assert.ok(!paid(restDay).some((item) => item.label.startsWith('OT_EXCESS')));
});

test('the statutory twelve-hour ceiling still validates beside an INCENTIVE boundary; only the boundary moves hours', () => {
	const measured = measure(MY, {
		workDays: [clock('2026-03-19', '08:30', '23:30')],
		...NIHON
	});
	// Fourteen worked hours: the statute's twelve-hour ceiling is a BLOCK the engine reports from
	// the same day, while pay splits at eleven. Six OT hours: three retained, three incentive.
	assert.equal(measured.overtimeDays[0].totalWorkHours, 14);
	assert.equal(lineOf(measured, 'OT_ORDINARY_BEYOND_NORMAL_0').quantity, 3);
	assert.equal(lineOf(measured, 'OT_EXCESS_ORDINARY_BEYOND_NORMAL_0').quantity, 3);
});
