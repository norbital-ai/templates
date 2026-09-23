// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The workday import's refusals, through the `work_days` transform an import writes through.
 *
 * Every statutory overtime limit splits (owner's rule, 2026-09-23), but only an import splits: it
 * hands the write each day's total already divided at the limits (`splitPlannedOvertime`), and the
 * write stores the two figures it is given. A direct write keys the two apart and is refused where
 * its approved hours pass a limit. What also refuses is not overtime: the weekly rest rule, a
 * shift whose own hours or spread-over breach a limit, a granted break short of the rules, and
 * overlapping shifts.
 *
 * Every figure below is derived by hand from the codes and limits stated here — Nihon's (MY-nihon)
 * roster codes and work rules, a Vietnam and an Indonesia version — not read from the seed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/collections/work_days/+collection.ts';
import {
	applicableLimits,
	rosterCodeFacts,
	splitPlannedOvertime,
	splitsOvertime
} from '../src/lib/scheduling/work-limits.ts';
import { validateOvertimeLimits } from '../src/collections/payroll_runs/lib/validate.ts';
import { transformSync } from './helpers/transform.ts';
import { VERSION, workDayDb } from './helpers/work-day-db.ts';

const limit = (key, period, measure, max_hours) => ({
	key,
	period,
	measure,
	max_hours,
	unit: 'WORKED_HOURS'
});
const weeklyRest = {
	key: 'weekly_rest',
	measure: 'CONSECUTIVE_WORK_DAYS',
	max_days: 6,
	discharged_by: 'REST'
};

/** MY-nihon: EA s.60A — 12 worked hours a day, 8 normal, 10 spread, 104 OT a month. */
const NIHON_RULES = {
	limits: [
		limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12),
		limit('normal_day', 'DAY', 'NORMAL_HOURS', 8),
		limit('spread_day', 'DAY', 'SPREAD_HOURS', 10),
		limit('weekly_normal', 'WEEK', 'NORMAL_HOURS', 45),
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104),
		weeklyRest
	],
	bands: [],
	breaks: [{ when: 'consecutive_hours > 5.0', owed_minutes: '30.0', counts_as_worked_time: null }]
};
/** VN: BLLĐ 2019 art.107 — 4 OT hours a day, 40 a month, 200 a year. */
const VN_RULES = {
	limits: [
		limit('daily_ot', 'DAY', 'OVERTIME_HOURS', 4),
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 40),
		limit('yearly_ot', 'YEAR', 'OVERTIME_HOURS', 200),
		weeklyRest
	],
	bands: []
};
/** ID: PP 35/2021 art.26 — 4 OT hours a day, 18 a week. */
const ID_RULES = {
	limits: [
		limit('daily_ot', 'DAY', 'OVERTIME_HOURS', 4),
		limit('weekly_ot', 'WEEK', 'OVERTIME_HOURS', 18),
		weeklyRest
	],
	bands: []
};

/** Nihon's codes: 8.0AM 08:30–17:30 and AM0830 08:30–18:30, each with a 60-minute break. */
const CODES = [
	{
		id: 'c-8',
		code: '8.0AM',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 }
	},
	{
		id: 'c-9',
		code: 'AM0830',
		variant: { kind: 'WORK', start_time: '08:30', end_time: '18:30', break_minutes: 60 }
	},
	// Not Nihon's: a 07:00–18:00 day (11h spread), a 6h day with a 15-minute break, and a
	// 07:00–21:00 day (13 paid hours).
	{
		id: 'c-long',
		code: 'LONG',
		variant: { kind: 'WORK', start_time: '07:00', end_time: '18:00', break_minutes: 60 }
	},
	{
		id: 'c-short-break',
		code: 'SB',
		variant: { kind: 'WORK', start_time: '09:00', end_time: '15:15', break_minutes: 15 }
	},
	{
		id: 'c-13',
		code: 'D13',
		variant: { kind: 'WORK', start_time: '07:00', end_time: '21:00', break_minutes: 60 }
	},
	// Nihon's PM2230 (22:30–08:30) and 03 (07:30–16:30).
	{
		id: 'c-night',
		code: 'PM2230',
		variant: { kind: 'WORK', start_time: '22:30', end_time: '08:30', break_minutes: 60 }
	},
	{
		id: 'c-early',
		code: '03',
		variant: { kind: 'WORK', start_time: '07:30', end_time: '16:30', break_minutes: 60 }
	},
	{ id: 'c-rest', code: 'REST', variant: { kind: 'REST' } }
];

const dbFor = (rules, days = []) =>
	workDayDb({
		codes: CODES,
		days,
		rosters: [{ employment_id: 'emp-1', period: '2026-07' }],
		versions: [{ ...VERSION, work_rules: rules }]
	});

const dayOf = (n) => `2026-07-${String(n).padStart(2, '0')}`;
/** July 2026 as creates: `plan(n)` is the code id and approved overtime for day n. */
const julyWrite = (plan) =>
	Array.from({ length: 31 }, (_, index) => {
		const [code, overtime = 0] = plan(index + 1);
		return {
			employment_id: 'emp-1',
			work_date: dayOf(index + 1),
			shift_definition_id: code,
			approved_overtime_hours: overtime
		};
	});
/** 6 on, 1 REST: July 7, 14, 21 and 28 rest — 27 working days. */
const sixOnOneOff = (work) => (n) => (n % 7 === 0 ? ['c-rest'] : work);
const write = (rules, inputs, days) => () =>
	transformSync(workDays, inputs, { db: dbFor(rules, days) });

/**
 * An import of `inputs`, whose `approved_overtime_hours` carry each day's planned TOTAL: the
 * import's own arithmetic divides it at the limits around the stored `days`, and the write stores
 * the two figures.
 */
const imported = (rules, inputs, days = []) => {
	const facts = new Map(CODES.map((code) => [code.id, rosterCodeFacts(code.variant)]));
	const planOf = (date, code) => ({ date, ...facts.get(code) });
	const split = splitPlannedOvertime({
		limits: applicableLimits(rules.limits, null),
		days: [
			...days.map((day) => ({
				...planOf(day.work_date, day.shift_definition_id),
				total_overtime_hours: day.approved_overtime_hours,
				fixed_overtime_hours: day.approved_overtime_hours
			})),
			...inputs.map((input) => ({
				...planOf(input.work_date, input.shift_definition_id),
				total_overtime_hours: input.approved_overtime_hours
			}))
		]
	});
	const keyed = inputs.map((input) => ({
		...input,
		approved_overtime_hours: split.get(input.work_date).approved_overtime_hours,
		incentive_hours: split.get(input.work_date).incentive_hours
	}));
	return write(rules, keyed, days)();
};

/** The stored split of the days that carry incentive: [date, overtime, incentive]. */
const incentiveDays = (out) =>
	out.flatMap((row) =>
		row.incentive_hours > 0
			? [[row.work_date.slice(0, 10), row.approved_overtime_hours, row.incentive_hours]]
			: []
	);

test('every overtime and total-hours limit splits; the normal day, the spread and the rest rule do not', () => {
	const splitting = (rules) =>
		applicableLimits(rules.limits, null)
			.filter(splitsOvertime)
			.map((limit) => limit.key);
	assert.deepEqual(splitting(NIHON_RULES), ['daily_total', 'monthly_ot']);
	assert.deepEqual(splitting(VN_RULES), ['daily_ot', 'monthly_ot', 'yearly_ot']);
	assert.deepEqual(splitting(ID_RULES), ['daily_ot', 'weekly_ot']);
	// SG: the regulated 72 and the all-overtime 72 both split.
	assert.deepEqual(
		[
			limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 72),
			limit('monthly_ot_all', 'MONTH', 'ALL_OVERTIME_HOURS', 72),
			limit('weekly_normal', 'WEEK', 'NORMAL_HOURS', 44)
		]
			.filter(splitsOvertime)
			.map((row) => row.key),
		['monthly_ot', 'monthly_ot_all']
	);
});

test('Nihon, imported → the 27th day’s 4 hours are stored as incentive, and payroll reports the 108', () => {
	// 4 OT hours a day: the first 26 working days fill 104 hours, the 27th day's 4 are incentive.
	const out = imported(NIHON_RULES, julyWrite(sixOnOneOff(['c-8', 4])));
	assert.deepEqual(incentiveDays(out), [['2026-07-31', 0, 4]]);
	// Keyed directly as overtime, the same month is refused on the day that passes 104.
	assert.throws(
		write(NIHON_RULES, julyWrite(sixOnOneOff(['c-8', 4]))),
		/2026-07-31 would hold 4 h of approved overtime, above the 0 h left within the 104-hour limit "monthly_ot"/
	);
	// Payroll still reports the planned month against the ceiling: incentive pays the excess, it
	// does not undo the breach.
	const issues = (hours) =>
		validateOvertimeLimits({
			employeeNumber: 'NHPMY0001',
			configuration: {
				limits: NIHON_RULES.limits,
				work: { authority: 'EA s.60A' },
				jurisdiction: { id: 'v' }
			},
			hoursByMonth: new Map([['2026-07', hours]])
		});
	assert.deepEqual(issues(104), []);
	assert.match(
		issues(108)[0].message,
		/108 regulated overtime hours in 2026-07, against a 104-hour/
	);
});

test('Nihon, refused: 7 consecutive WORK days breaks the weekly rest rule (6)', () => {
	const inputs = julyWrite((n) => (n <= 7 || n % 7 !== 0 ? ['c-8'] : ['c-rest']));
	assert.throws(
		write(NIHON_RULES, inputs),
		/2026-07-01 to 2026-07-13 would be 13 consecutive worked day\(s\).*allows 6/s
	);
});

test('Nihon, imported: 9h paid + 4h planned OT is 13 worked hours — 3 within daily_total 12, 1 incentive', () => {
	const inputs = julyWrite((n) => (n === 2 ? ['c-9', 4] : sixOnOneOff(['c-8'])(n)));
	assert.deepEqual(incentiveDays(imported(NIHON_RULES, inputs)), [['2026-07-02', 3, 1]]);
	assert.throws(write(NIHON_RULES, inputs), /2026-07-02 would hold 4 h .* above the 3 h left/);
});

test('Nihon, refused: a 13-hour shift is above daily_total 12 by its own hours, which are not overtime', () => {
	const inputs = julyWrite((n) => (n === 2 ? ['c-13'] : sixOnOneOff(['c-8'])(n)));
	assert.throws(
		write(NIHON_RULES, inputs),
		/through 2026-07-02 projects 13\.00 worked hours in the day, above the 12-hour limit "daily_total"/
	);
});

test('Nihon, refused: a 07:00–18:00 shift spreads over 11 hours, above spread_day 10', () => {
	const inputs = julyWrite((n) => (n === 3 ? ['c-long'] : sixOnOneOff(['c-8'])(n)));
	assert.throws(
		write(NIHON_RULES, inputs),
		/through 2026-07-03 projects 11\.00 spread-over hours in the day, above the 10-hour limit "spread_day"/
	);
});

test('Nihon, refused: a 6-hour shift granting 15 minutes of break, where 30 are owed', () => {
	const inputs = julyWrite((n) => (n === 6 ? ['c-short-break'] : sixOnOneOff(['c-8'])(n)));
	assert.throws(
		write(NIHON_RULES, inputs),
		/on 2026-07-06 is refused: the shift grants 15 minutes of break, but the rules require 30 for a 6\.00-hour day/
	);
});

test('VN, imported: 11 days × 4h is 44 hours, 40 within the monthly limit and 4 incentive', () => {
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n <= 12 ? 4 : 0]));
	// Days 1–12 less the 7th: the tenth working day (the 11th) fills 40; the 12th is incentive.
	assert.deepEqual(incentiveDays(imported(VN_RULES, inputs)), [['2026-07-12', 0, 4]]);
	// 6h on one ordinary day is 4 within daily_ot and 2 incentive.
	const sixHours = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n === 1 ? 6 : 0]));
	assert.deepEqual(incentiveDays(imported(VN_RULES, sixHours)), [['2026-07-01', 4, 2]]);
});

test('VN, imported: 160 stored OT hours this year plus July’s 44 splits at yearly_ot 200', () => {
	// Ten Mon–Thu days in each of January to April, 4 approved hours each: 40 a month, 160.
	const storedDay = (date) => ({
		id: `s-${date}`,
		employment_id: 'emp-1',
		work_date: date,
		shift_definition_id: 'c-8',
		approved_overtime_hours: 4
	});
	const monThu = (month) =>
		Array.from({ length: 31 }, (_, index) => new Date(Date.UTC(2026, month, index + 1)))
			.filter((date) => date.getUTCMonth() === month && [1, 2, 3, 4].includes(date.getUTCDay()))
			.map((date) => date.toISOString().slice(0, 10));
	const stored = [0, 1, 2, 3].flatMap((month) => monThu(month).slice(0, 10)).map(storedDay);
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n <= 12 ? 4 : 0]));
	// The year has 40 left, exactly July's month: the 12th is incentive by the month alone.
	assert.deepEqual(incentiveDays(imported(VN_RULES, inputs, stored)), [['2026-07-12', 0, 4]]);
	// Four more in May leave the year 24: the sixth working day of July fills it.
	const more = [...stored, ...monThu(4).slice(0, 4).map(storedDay)];
	assert.deepEqual(incentiveDays(imported(VN_RULES, inputs, more)), [
		['2026-07-08', 0, 4],
		['2026-07-09', 0, 4],
		['2026-07-10', 0, 4],
		['2026-07-11', 0, 4],
		['2026-07-12', 0, 4]
	]);
});

test('ID, imported: five days × 4h in one week is 20, 18 within weekly_ot and 2 incentive', () => {
	// Week of Monday 6 July (the 7th is its rest day): days 8–12 carry 4 hours each.
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n >= 8 && n <= 12 ? 4 : 0]));
	assert.deepEqual(incentiveDays(imported(ID_RULES, inputs)), [['2026-07-12', 2, 2]]);
});

test('Nihon, refused: PM2230 on the 9th runs to 08:30, overlapping 03 from 07:30 on the 10th', () => {
	// Both days are new rows of the same import batch: the overlap is between them.
	const inputs = julyWrite((n) =>
		n === 9 ? ['c-night'] : n === 10 ? ['c-early'] : sixOnOneOff(['c-8'])(n)
	);
	assert.throws(write(NIHON_RULES, inputs), /overlap/i);
});
