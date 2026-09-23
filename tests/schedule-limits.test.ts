/**
 * The schedule-time roster gate: a shift's own hours or spread-over above a `work_rules` limit
 * refuse a plan; an overtime limit never does (it splits planned overtime, `splitPlannedOvertime`).
 * These drive the pure decision the `work_days` and `shift_patterns` transforms quote, with the
 * CLOCK evaluation the priced work-day context shares.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkLimit } from '../src/datatypes/work_rules/+definition.ts';
import {
	evaluatedLimits,
	plannedDay,
	projectedLimitBreaches,
	projectionBounds,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../src/lib/scheduling/work-limits.ts';

const MY_LIMITS: readonly WorkLimit[] = [
	{
		key: 'daily_total',
		period: 'DAY',
		measure: 'TOTAL_WORK_HOURS',
		max_hours: 12,
		unit: 'CLOCK_HOURS'
	},
	{ key: 'normal_day', period: 'DAY', measure: 'NORMAL_HOURS', max_hours: 8, unit: 'WORKED_HOURS' },
	{
		key: 'spread_day',
		period: 'DAY',
		measure: 'SPREAD_HOURS',
		max_hours: 10,
		unit: 'WORKED_HOURS'
	},
	{
		key: 'weekly_total',
		period: 'WEEK',
		measure: 'TOTAL_WORK_HOURS',
		max_hours: 45,
		unit: 'WORKED_HOURS'
	},
	{
		key: 'monthly_ot',
		period: 'MONTH',
		measure: 'OVERTIME_HOURS',
		max_hours: 104,
		unit: 'WORKED_HOURS'
	}
];

const day = (date: string, paid: number, breakMinutes = 0): SchedulePlanDay => ({
	date,
	kind: 'WORK',
	paid_minutes: paid * 60,
	break_minutes: breakMinutes,
	spread_hours: paid + breakMinutes / 60
});

const planOf = (days: readonly SchedulePlanDay[]): Map<string, SchedulePlanDay> =>
	new Map(days.map((plan) => [plan.date, plan]));

const breachOn = (
	days: readonly SchedulePlanDay[],
	limits: readonly WorkLimit[],
	changed: readonly string[]
) =>
	projectedLimitBreaches({
		subject: 'PUB-EMP-0001',
		changedDates: new Set(changed),
		planByDate: planOf(days),
		limits
	});

test('a CLOCK day limit is evaluated against the granted break', () => {
	assert.equal(evaluatedLimits(MY_LIMITS, 60).daily_total, 11);
	const exact = breachOn([day('2026-02-02', 8, 60)], MY_LIMITS, ['2026-02-02']);
	assert.deepEqual(exact, [], 'eight net worked hours is below every evaluated ceiling');
	const over = breachOn([day('2026-02-02', 12, 60)], MY_LIMITS, ['2026-02-02']);
	assert.equal(over[0]?.key, 'daily_total');
	assert.equal(over[0]?.maximum, 11);
	assert.equal(over[0]?.projected, 12);
});

test('a plan breaches spread on the day it is written; hours past normal are overtime, not a breach', () => {
	const breaches = breachOn([day('2026-02-02', 9.5, 60)], MY_LIMITS, ['2026-02-02']);
	assert.deepEqual(
		breaches.map((breach) => breach.key),
		['spread_day'],
		'a nine-and-a-half-hour day plans 1.5 overtime hours and its spread over ten'
	);
	// Nihon's real 08:30–18:00 shift: 8.5 paid hours against an eight-hour normal is lawful.
	assert.deepEqual(breachOn([day('2026-02-02', 8.5, 60)], MY_LIMITS, ['2026-02-02']), []);
});

test('a week exactly at the ceiling passes; one more hour is refused', () => {
	const week = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07'];
	const at = week.map((date) => day(date, 7.5));
	assert.deepEqual(breachOn(at, MY_LIMITS, week), []);
	const over = week.map((date) => day(date, 8, 60));
	const breaches = breachOn(over, MY_LIMITS, week);
	const weekly = breaches.filter((breach) => breach.key === 'weekly_total');
	assert.equal(weekly.length, 1, 'one breach per changed date in the breaching week');
	assert.equal(weekly[0]?.projected, 48);
	assert.equal(weekly[0]?.maximum, 45);
});

test('an overtime limit is not a roster gate: hours past the normal day never refuse the plan', () => {
	// Four nine-hour days against an eight-hour normal and a 3-hour month: overtime limits split
	// planned overtime; the shift's own hours are not overtime and are judged by total and spread.
	const month = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05'];
	const tight = MY_LIMITS.map((limit) =>
		limit.key === 'monthly_ot' ? { ...limit, max_hours: 3 } : limit
	);
	assert.deepEqual(
		breachOn(
			month.map((date) => day(date, 9, 60)),
			tight,
			month
		).map((breach) => breach.key),
		[]
	);
});

test('a breach outside the changed dates is not this write’s refusal', () => {
	const over = [
		'2026-02-02',
		'2026-02-03',
		'2026-02-04',
		'2026-02-05',
		'2026-02-06',
		'2026-02-07'
	].map((date) => day(date, 8, 60));
	const nextWeek = ['2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13'].map(
		(date) => day(date, 6, 60)
	);
	const untouched = breachOn([...over, ...nextWeek], MY_LIMITS, ['2026-02-09', '2026-02-10']);
	assert.deepEqual(
		untouched,
		[],
		'the following week projects its own hours, not the breaching week behind it'
	);
	const touched = breachOn([...over, ...nextWeek], MY_LIMITS, ['2026-02-06']);
	assert.equal(touched[0]?.key, 'weekly_total');
});

test('projection bounds align to the widest limit the version declares', () => {
	const year = projectionBounds(
		['2026-02-03'],
		[{ key: 'x', period: 'YEAR', measure: 'OVERTIME_HOURS', max_hours: 1, unit: 'WORKED_HOURS' }]
	);
	assert.deepEqual(year, { start: '2026-01-01', end: '2026-12-31' });
	const quarter = projectionBounds(
		['2026-02-03', '2026-11-30'],
		[{ key: 'x', period: 'QUARTER', measure: 'OVERTIME_HOURS', max_hours: 1, unit: 'WORKED_HOURS' }]
	);
	assert.deepEqual(quarter, { start: '2026-01-01', end: '2026-12-31' });
	const month = projectionBounds(
		['2026-02-03'],
		[{ key: 'x', period: 'MONTH', measure: 'OVERTIME_HOURS', max_hours: 1, unit: 'WORKED_HOURS' }]
	);
	assert.deepEqual(month, { start: '2026-02-01', end: '2026-02-28' });
	const week = projectionBounds(
		['2026-02-03'],
		[{ key: 'x', period: 'WEEK', measure: 'OVERTIME_HOURS', max_hours: 1, unit: 'WORKED_HOURS' }]
	);
	assert.deepEqual(week, { start: '2026-02-02', end: '2026-02-08' });
});

test('a day with no code projects nothing', () => {
	const codeById = new Map<string, RosterCodeFacts>([
		['work', { kind: 'WORK', paid_minutes: 480, break_minutes: 60, spread_hours: 9 }],
		['rest', { kind: 'REST', paid_minutes: 0, break_minutes: 0, spread_hours: 0 }]
	]);
	assert.deepEqual(plannedDay({ date: '2026-02-02', rosterCodeId: null, codeById }), {
		date: '2026-02-02',
		kind: null,
		paid_minutes: 0,
		break_minutes: 0,
		spread_hours: 0
	});
	assert.equal(
		plannedDay({ date: '2026-02-02', rosterCodeId: 'work', codeById }).paid_minutes,
		480
	);
	assert.equal(plannedDay({ date: '2026-02-02', rosterCodeId: 'rest', codeById }).kind, 'REST');
});
