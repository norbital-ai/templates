/**
 * The work band engine: a band prices its slice, and the day's planned incentive hours — the top
 * of its payable hours — settle on the band's incentive line at its own award.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	priceWorkDay,
	type WorkBandDay,
	type WorkBandRates,
	type WorkBandRow
} from '../src/lib/payroll/work-bands.ts';
import type { WorkRules } from '../src/datatypes/work_rules/+definition.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

const person = personContext({
	employee: null,
	employment: { service_start: '2020-01-01' },
	terms: null,
	asOf: '2026-06-30'
});

const limits = (): WorkRules['limits'] => [
	{
		key: 'daily_total',
		period: 'DAY',
		measure: 'TOTAL_WORK_HOURS',
		max_hours: 12,
		unit: 'CLOCK_HOURS'
	},
	{
		key: 'monthly_ot',
		period: 'MONTH',
		measure: 'OVERTIME_HOURS',
		max_hours: 104,
		unit: 'WORKED_HOURS'
	}
];

const base = {
	proration: { by: 'CALENDAR_DAYS' as const },
	limits: limits(),
	breaks: [],
	wages: { by_region: {} },
	holiday_rest_precedence: 'SUBSTITUTE' as const
};

const nihon: WorkRules = {
	...base,
	ordinary_divisor_days: '26.0',
	overtime_when: '',
	bands: [
		{
			label: '1.5',
			when: 'day_type == "ORDINARY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'hours_beyond_normal * ordinary_hour * 1.5'
		}
	]
};

const philippines: WorkRules = {
	...base,
	ordinary_divisor_days: '21.75',
	overtime_when: '',
	bands: [
		{
			label: '2.0',
			when: 'day_type == "PUBLIC_HOLIDAY"',
			take_hours: 'normal_hours',
			price_amount: 'normal_hours * day_wage * 2.0'
		},
		{
			label: '3.0',
			when: 'day_type == "PUBLIC_HOLIDAY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'hours_beyond_normal * ordinary_hour * 3.0'
		}
	]
};

const day = (overrides: Partial<WorkBandDay>): WorkBandDay => ({
	workDayId: 'day-1',
	date: '2026-06-15',
	dayType: 'ORDINARY',
	workedHours: 13,
	normalHours: 9,
	overtimeHours: 4,
	breakMinutes: 60,
	holidayKind: '',
	holidayName: '',
	monthOvertimeHours: 20,
	continuousAttendance: false,
	consecutiveHours: 4,
	...overrides
});

const rates: WorkBandRates = { ordinaryHour: 25.5, ordinaryDay: 204, dayWage: 204 };

test('an ordinary day’s planned incentive hours settle at the band’s own award', () => {
	const rows: WorkBandRow[] = priceWorkDay({
		work: nihon,
		person,
		day: day({ incentiveHours: 2 }),
		rates
	});
	assert.deepEqual(
		rows.map((row) => [row.line, row.label, row.hours, Math.round(row.amount * 100) / 100]),
		[
			['OVERTIME', '1.5', 2, 76.5],
			['INCENTIVE', '1.5', 2, 76.5]
		]
	);
});

test('a holiday keeps its ×3 for the incentive hours', () => {
	const rows = priceWorkDay({
		work: philippines,
		person,
		day: day({ dayType: 'PUBLIC_HOLIDAY', workedHours: 12, overtimeHours: 12, incentiveHours: 1 }),
		rates
	});
	assert.deepEqual(
		rows.map((row) => [row.line, row.label, row.hours, Math.round(row.amount * 100) / 100]),
		[
			['OVERTIME', '2.0', 9, 3672],
			['OVERTIME', '3.0', 2, 153],
			['INCENTIVE', '3.0', 1, 76.5]
		]
	);
});

test('incentive hours continue the day past the cap: each hour takes the band and multiple it falls in', () => {
	// A holiday of 12 planned hours, 7 within the limits and 5 incentive: the 2.0 band takes the
	// normal day (hours 0–9) and the 3.0 band the rest (9–12). Continuing past the seventh hour,
	// two incentive hours fall in the 2.0 band and three in the 3.0 band — each at that band's rate,
	// exactly as those hours would have paid as overtime.
	const holiday: WorkRules = {
		...philippines,
		bands: [
			{
				label: '2.0',
				when: 'day_type == "PUBLIC_HOLIDAY"',
				take_hours: 'normal_hours',
				price_amount: 'hours * ordinary_hour * 2.0'
			},
			{
				label: '3.0',
				when: 'day_type == "PUBLIC_HOLIDAY"',
				take_hours: 'hours_beyond_normal',
				price_amount: 'hours * ordinary_hour * 3.0'
			}
		]
	};
	const priced = (incentiveHours: number) =>
		priceWorkDay({
			work: holiday,
			person,
			day: day({ dayType: 'PUBLIC_HOLIDAY', workedHours: 12, overtimeHours: 12, incentiveHours }),
			rates
		});
	const rows = priced(5);
	assert.deepEqual(
		rows.map((row) => [row.line, row.label, row.hours, row.rate, row.amount]),
		[
			['OVERTIME', '2.0', 7, 51, 357],
			['INCENTIVE', '2.0', 2, 51, 102],
			['INCENTIVE', '3.0', 3, 76.5, 229.5]
		]
	);
	// Moving hours between the entries moves no money: the day pays what it would all as overtime.
	const total = (list: readonly WorkBandRow[]) => list.reduce((sum, row) => sum + row.amount, 0);
	assert.equal(total(rows), total(priced(0)));
});

test('a day with no incentive hours produces one row and no incentive row', () => {
	const rows = priceWorkDay({
		work: nihon,
		person,
		day: day({ workedHours: 11, overtimeHours: 2 }),
		rates
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.line, 'OVERTIME');
	assert.equal(rows[0]?.hours, 2);
});

test('the evaluated CLOCK limit subtracts the shift break', async () => {
	const { evaluatedLimits } = await import('../src/lib/scheduling/work-limits.ts');
	assert.equal(evaluatedLimits(nihon.limits, 60).daily_total, 11);
	assert.equal(evaluatedLimits(nihon.limits, 0).daily_total, 12);
});

test('an OFF day is priced as ordinary overtime: every hour worked is beyond the normal week', () => {
	// A five-day week's Saturday. No shift, so the whole clocked day is overtime, and the band
	// that says `day_type == "ORDINARY"` must take all of it — an OFF day that matched no band
	// paid nothing for the day.
	const rows = priceWorkDay({
		work: nihon,
		person,
		day: day({ dayType: 'OFF_DAY', workedHours: 5, overtimeHours: 5 }),
		rates
	});
	assert.deepEqual(
		rows.map((row) => [row.line, row.label, row.hours, Math.round(row.amount * 100) / 100]),
		[['OVERTIME', '1.5', 5, 191.25]]
	);
});
