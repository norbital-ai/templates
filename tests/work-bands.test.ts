/**
 * The work band engine: a band prices its slice, and the slice above the named
 * limit funnels to the incentive line at the band's own award.
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
	weekly_rest_rule: { max_consecutive_work_days: 6, discharged_by: 'REST' as const },
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
			price_amount: 'hours_beyond_normal * ordinary_hour * 1.5',
			funnel_above_hours: 'limits.daily_total'
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
			price_amount: 'hours_beyond_normal * ordinary_hour * 3.0',
			funnel_above_hours: 'limits.daily_total'
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
	rosterCode: 'AM0830',
	holidayKind: '',
	holidayName: '',
	monthOvertimeHours: 20,
	continuousAttendance: false,
	consecutiveHours: 4,
	...overrides
});

const rates: WorkBandRates = { ordinaryHour: 25.5, ordinaryDay: 204, dayWage: 204 };

test('an ordinary overrun funnels the hours above the limit at the band’s own award', () => {
	const rows: WorkBandRow[] = priceWorkDay({ work: nihon, person, day: day({}), rates });
	assert.deepEqual(
		rows.map((row) => [row.line, row.label, row.hours, Math.round(row.amount * 100) / 100]),
		[
			['OVERTIME', '1.5', 2, 76.5],
			['INCENTIVE', '1.5', 2, 76.5]
		]
	);
});

test('a holiday keeps its ×3 for the funneled hours', () => {
	const rows = priceWorkDay({
		work: philippines,
		person,
		day: day({ dayType: 'PUBLIC_HOLIDAY', workedHours: 12, overtimeHours: 12 }),
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

test('a day under the limit produces one row and no funnel row', () => {
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
