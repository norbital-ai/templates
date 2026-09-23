// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The workday import's refusal/warning split, through the `work_days` transform an import writes
 * through.
 *
 * A ceiling payroll funnels to INCENTIVE only warns: the monthly overtime cap
 * (`monthlyFunnelLimit`) and a day limit a band's `funnel_above_hours` names as `limits.<key>`.
 * Every other statutory ceiling is a hard refusal. Approved overtime is worked time: a day's hours
 * are the code's paid hours plus its approved overtime, and its overtime likewise.
 *
 * Every figure below is derived by hand from the codes and limits stated here — Nihon's (MY-nihon)
 * roster codes and work rules, a Vietnam and an Indonesia version — not read from the seed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/collections/work_days/+collection.ts';
import {
	applicableLimits,
	funnelledLimitKeys,
	projectedLimitBreaches,
	plannedDay
} from '../src/lib/scheduling/work-limits.ts';
import { funnelMonthlyOvertime } from '../src/lib/payroll/work.ts';
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

/** MY-nihon: EA s.60A — 12 worked hours a day, 8 normal, 10 spread, 104 OT a month; 11h funnel. */
const NIHON_RULES = {
	limits: [
		limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12),
		limit('normal_day', 'DAY', 'NORMAL_HOURS', 8),
		limit('spread_day', 'DAY', 'SPREAD_HOURS', 10),
		limit('weekly_normal', 'WEEK', 'NORMAL_HOURS', 45),
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 104),
		weeklyRest
	],
	bands: [{ label: 'WORKDAY-OT-1.5X', funnel_above_hours: '11.0' }],
	breaks: [{ when: 'consecutive_hours > 5.0', owed_minutes: '30.0', counts_as_worked_time: null }]
};
/** VN: BLLĐ 2019 art.107 — 4 OT hours a day (funnelled by OT-1.5X), 40 a month, 200 a year. */
const VN_RULES = {
	limits: [
		limit('daily_ot', 'DAY', 'OVERTIME_HOURS', 4),
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 40),
		limit('yearly_ot', 'YEAR', 'OVERTIME_HOURS', 200),
		weeklyRest
	],
	bands: [{ label: 'OT-1.5X', funnel_above_hours: 'normal_hours + limits.daily_ot' }]
};
/** ID: PP 35/2021 art.26 — 4 OT hours a day, 18 a week; no band funnels. */
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
	// Not Nihon's: a 07:00–18:00 day (11h spread) and a 6h day with a 15-minute break.
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

test('the funnelled limits are the monthly overtime cap and a day limit a band names', () => {
	assert.deepEqual(
		[...funnelledLimitKeys(NIHON_RULES, applicableLimits(NIHON_RULES.limits, null))],
		['monthly_ot']
	);
	assert.deepEqual(
		[...funnelledLimitKeys(VN_RULES, applicableLimits(VN_RULES.limits, null))].toSorted(),
		['daily_ot', 'monthly_ot']
	);
	assert.deepEqual([...funnelledLimitKeys(ID_RULES, applicableLimits(ID_RULES.limits, null))], []);
	// SG: the regulated 72 is funnelled, the all-overtime 72 is not.
	const sg = [
		limit('monthly_ot', 'MONTH', 'OVERTIME_HOURS', 72),
		limit('monthly_ot_all', 'MONTH', 'ALL_OVERTIME_HOURS', 72)
	];
	assert.deepEqual([...funnelledLimitKeys({ bands: [] }, sg)], ['monthly_ot']);
});

test('Nihon, accepted: 27 days of 8h + 4h approved OT is 108 OT hours, over the funnelled 104', () => {
	const inputs = julyWrite(sixOnOneOff(['c-8', 4]));
	// Without the funnel the plan breaches monthly_ot: 27 × 4 = 108 > 104.
	const planByDate = new Map(
		inputs.map((input) => {
			const facts =
				input.shift_definition_id === 'c-8'
					? { kind: 'WORK', paid_minutes: 480, break_minutes: 60, spread_hours: 9 }
					: { kind: 'REST', paid_minutes: 0, break_minutes: 0, spread_hours: 0 };
			return [
				input.work_date,
				plannedDay({
					date: input.work_date,
					rosterCodeId: 'x',
					codeById: new Map([['x', facts]]),
					approvedOvertimeHours: input.approved_overtime_hours
				})
			];
		})
	);
	const unfunnelled = projectedLimitBreaches({
		subject: 'emp-1',
		changedDates: new Set(inputs.map((input) => input.work_date)),
		planByDate,
		limits: applicableLimits(NIHON_RULES.limits, null)
	});
	assert.deepEqual(
		unfunnelled.map((breach) => [breach.key, breach.projected]),
		[['monthly_ot', 108]]
	);
	// Through the transform: 12 worked hours a day is not above daily_total, and monthly_ot funnels.
	assert.equal(write(NIHON_RULES, inputs)().length, 31);
});

test('Nihon, accepted at write → payroll warns OVERTIME_LIMIT_EXCEEDED and prices the excess as INCENTIVE', () => {
	const workDates = Array.from({ length: 31 }, (_, index) => index + 1).filter((n) => n % 7 !== 0);
	const days = workDates.map((n) => ({ workDayId: `d${n}`, date: dayOf(n) }));
	const overtime = {
		family: 'WORK',
		output: 'OVERTIME:WORKDAY-OT-1.5X',
		destination: 'EARNINGS',
		direction: 'CREDIT',
		code: 'OT'
	};
	const incentive = {
		family: 'WORK',
		output: 'INCENTIVE:WORKDAY-OT-1.5X',
		destination: 'EARNINGS',
		direction: 'CREDIT',
		code: 'PINCEN'
	};
	// 4 OT hours a day at RM15/h: the first 26 days fill 104 hours, the 27th day's 4 are incentive.
	const out = funnelMonthlyOvertime({
		rows: days.map((day) => ({
			input: { family: 'WORK_DAY', id: day.workDayId },
			catalogueComponent: overtime,
			bucket: 'EARNINGS',
			label: 'WORKDAY-OT-1.5X',
			amount: 60,
			quantity: 4,
			rate: 15,
			statutoryRuleKey: 'OVERTIME:WORKDAY-OT-1.5X'
		})),
		days,
		limits: NIHON_RULES.limits.filter((row) => row.measure !== 'CONSECUTIVE_WORK_DAYS'),
		holds: () => false,
		prior: new Map(),
		catalogueComponents: [overtime, incentive]
	});
	const incentiveRows = out.rows.filter((row) =>
		row.catalogueComponent.output.startsWith('INCENTIVE')
	);
	assert.deepEqual(
		incentiveRows.map((row) => [row.input.id, row.quantity, row.amount]),
		[['d31', 4, 60]]
	);
	assert.deepEqual([...out.funnelledHours], [['2026-07', 4]]);
	const issues = validateOvertimeLimits({
		employeeNumber: 'NHPMY0001',
		configuration: {
			limits: NIHON_RULES.limits,
			work: { authority: 'EA s.60A' },
			jurisdiction: { id: 'v' }
		},
		hoursByMonth: new Map([['2026-07', 108]])
	});
	assert.deepEqual(
		issues.map((issue) => [issue.code, issue.severity]),
		[['OVERTIME_LIMIT_EXCEEDED', 'WARNING']]
	);
	assert.match(issues[0].message, /108 regulated overtime hours in 2026-07, against a 104-hour/);
});

test('Nihon, refused: 7 consecutive WORK days breaks the weekly rest rule (6)', () => {
	const inputs = julyWrite((n) => (n <= 7 || n % 7 !== 0 ? ['c-8'] : ['c-rest']));
	assert.throws(
		write(NIHON_RULES, inputs),
		/2026-07-01 to 2026-07-13 would be 13 consecutive worked day\(s\).*allows 6/s
	);
});

test('Nihon, refused: 9h paid + 4h approved OT is 13 worked hours, above daily_total 12', () => {
	const inputs = julyWrite((n) => (n === 2 ? ['c-9', 4] : sixOnOneOff(['c-8'])(n)));
	assert.throws(
		write(NIHON_RULES, inputs),
		/through 2026-07-02 projects 13\.00 worked hours in the day, above the 12-hour limit "daily_total"/
	);
	// 9h + 3h = 12 is at the ceiling, not above it — and 1h of it funnels above 11 at payroll.
	const atCeiling = julyWrite((n) => (n === 2 ? ['c-9', 3] : sixOnOneOff(['c-8'])(n)));
	assert.equal(write(NIHON_RULES, atCeiling)().length, 31);
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

test('VN, accepted: 11 days × 4h approved OT is 44 hours, over the funnelled monthly 40 and at daily_ot', () => {
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n <= 12 ? 4 : 0]));
	// Days 1–12 less the 7th: 11 days × 4 = 44 > 40 (funnelled); 4 a day is not above daily_ot.
	assert.equal(write(VN_RULES, inputs)().length, 31);
	// 6h approved on one day is above daily_ot 4 — funnelled by OT-1.5X, so still accepted.
	const sixHours = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n === 1 ? 6 : 0]));
	assert.equal(write(VN_RULES, sixHours)().length, 31);
});

test('VN, refused: 160 stored OT hours this year plus July’s 44 is 204, above yearly_ot 200', () => {
	// Forty stored days, Mon–Thu from 2 March for ten weeks, each with 4 approved hours: 160.
	const stored = [];
	for (let week = 0; week < 10; week += 1)
		for (let weekday = 0; weekday < 4; weekday += 1) {
			const date = new Date(Date.UTC(2026, 2, 2 + week * 7 + weekday)).toISOString().slice(0, 10);
			stored.push({
				id: `s-${date}`,
				employment_id: 'emp-1',
				work_date: date,
				shift_definition_id: 'c-8',
				approved_overtime_hours: 4
			});
		}
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n <= 12 ? 4 : 0]));
	assert.throws(
		write(VN_RULES, inputs, stored),
		/projects 204\.00 overtime hours in the year, above the 200-hour limit "yearly_ot"/
	);
});

test('ID, refused: five days × 4h approved OT in one week is 20, above weekly_ot 18', () => {
	// Week of Monday 6 July (the 7th is its rest day): days 8–12 carry 4 hours each.
	const inputs = julyWrite((n) => (n % 7 === 0 ? ['c-rest'] : ['c-8', n >= 8 && n <= 12 ? 4 : 0]));
	assert.throws(
		write(ID_RULES, inputs),
		/projects 20\.00 overtime hours in the week, above the 18-hour limit "weekly_ot"/
	);
});

test('Nihon, refused: PM2230 on the 9th runs to 08:30, overlapping 03 from 07:30 on the 10th', () => {
	// Both days are new rows of the same import batch: the overlap is between them.
	const inputs = julyWrite((n) =>
		n === 9 ? ['c-night'] : n === 10 ? ['c-early'] : sixOnOneOff(['c-8'])(n)
	);
	assert.throws(write(NIHON_RULES, inputs), /overlap/i);
});
