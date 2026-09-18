/**
 * The `work_rules` shape: a Nihon-shaped rule set parses, malformed rules are
 * refused.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { workRulesValueSchema } from '../src/datatypes/work_rules/+definition.ts';

const decode = Schema.decodeUnknownSync(workRulesValueSchema);

const nihon = {
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_divisor_days: '26.0',
	overtime_when: '',
	bands: [
		{
			label: '1.5',
			when: 'day_type == "ORDINARY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'ordinary_hour * 1.5',
			funnel_above_hours: 'limits.daily_total'
		},
		{
			label: '3.0',
			when: 'day_type == "PUBLIC_HOLIDAY"',
			take_hours: 'hours_beyond_normal',
			price_amount: 'ordinary_hour * 3.0',
			funnel_above_hours: 'limits.daily_total'
		}
	],
	authority: 'Employment Act 1955 ss.60, 60A, 60D',
	limits: [
		{
			key: 'daily_total',
			period: 'DAY',
			measure: 'TOTAL_WORK_HOURS',
			max_hours: 12,
			unit: 'CLOCK_HOURS',
			authority: 'Employment Act 1955 s.60A'
		},
		{
			key: 'monthly_ot',
			period: 'MONTH',
			measure: 'OVERTIME_HOURS',
			max_hours: 104,
			unit: 'WORKED_HOURS'
		}
	],
	breaks: [
		{ when: 'consecutive_hours > 5', owed_minutes: '30.0', counts_as_worked_time: false },
		{
			when: 'overtime_hours > 2',
			owed_minutes: 'overtime_hours > 4 ? 60 : 30',
			counts_as_worked_time: null
		}
	],
	wages: { by_region: {} },
	holiday_rest_precedence: 'SUBSTITUTE'
};

test('a Nihon-shaped rule set parses', () => {
	const rules = decode(nihon);
	assert.equal(rules.bands.length, 2);
	assert.equal(rules.limits[0]?.key, 'daily_total');
	assert.equal(rules.breaks[1]?.owed_minutes, 'overtime_hours > 4 ? 60 : 30');
});

test('malformed rules are refused', () => {
	for (const bad of [
		{ ...nihon, proration: '' },
		{ ...nihon, ordinary_divisor_days: '' },
		{ ...nihon, ordinary_divisor_days: 'terms.grade' },
		{ ...nihon, overtime_when: 'terms.nope == 1' },
		{ ...nihon, overtime_when: 'terms.basic_salary' },
		{
			...nihon,
			authority: 'Employment Act 1955 ss.60, 60A, 60D',
			limits: [{ key: '', period: 'DAY', measure: 'TOTAL_WORK_HOURS', max_hours: 12 }]
		},
		{
			...nihon,
			authority: 'Employment Act 1955 ss.60, 60A, 60D',
			limits: [
				{
					key: 'x',
					period: 'FORTNIGHT',
					measure: 'TOTAL_WORK_HOURS',
					max_hours: 12,
					unit: 'WORKED_HOURS'
				}
			]
		},
		{ ...nihon, bands: [{ ...nihon.bands[0], when: '' }] },
		{ ...nihon, holiday_rest_precedence: 'NONE' },
		// CEL is compiled at write: a misspelt member or the wrong result type is refused here,
		// not when a payroll prices the month the version governs (acceptance 1).
		{ ...nihon, bands: [{ ...nihon.bands[0], when: 'day_typo == "ORDINARY"' }] },
		{
			...nihon,
			bands: [{ ...nihon.bands[0], take_hours: 'roster_code' }]
		},
		{
			...nihon,
			bands: [{ ...nihon.bands[0], price_amount: 'ordinary_hour * "x"' }]
		},
		{ ...nihon, bands: [{ ...nihon.bands[0], funnel_above_hours: 'limits.no_such_limit' }] },
		{ ...nihon, ordinary_divisor_days: 'terms.nope > 1 ? 173.0 : 26.0' },
		{
			...nihon,
			breaks: [
				{ when: 'consecutive_hours_typo > 5', owed_minutes: '30.0', counts_as_worked_time: false }
			]
		},
		{
			...nihon,
			breaks: [
				{
					when: 'consecutive_hours > 5',
					owed_minutes: 'typod_hours * 2',
					counts_as_worked_time: false
				}
			]
		}
	])
		assert.throws(() => decode(bad), undefined, JSON.stringify(bad).slice(0, 80));
});
