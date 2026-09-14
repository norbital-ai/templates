/**
 * The `work_rules` shape (RFC 0001 §4–§6): a Nihon-shaped rule set parses, malformed rules are
 * refused.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { workRulesValueSchema } from '../src/datatypes/work_rules/+definition.ts';

const decode = Schema.decodeUnknownSync(workRulesValueSchema);

const EPF = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SOCSO = 'adf0f0e0-6b3f-4e3f-9a1e-1f2f3a4b5c6d';

const nihon = {
	proration: { by: 'CALENDAR_DAYS' },
	engine_lines: {
		salary: {
			statutory_opt_ins: [
				{ contribution_id: EPF, effect: 'INCLUDE' },
				{ contribution_id: SOCSO, effect: 'INCLUDE' }
			]
		},
		absence: { statutory_opt_ins: [{ contribution_id: EPF, effect: 'REDUCE' }] },
		night: { statutory_opt_ins: [{ contribution_id: SOCSO, effect: 'INCLUDE' }] }
	},
	rates: {
		ordinary: [{ when: '', unit: 'DAY', divisor: 26 }],
		bands: [
			{
				label: '1.5',
				line: 'OVERTIME',
				when: 'day_type == "ORDINARY"',
				take: 'hours_beyond_normal',
				price: 'ordinary_hour * 1.5',
				funnel: { above: 'limits.daily_total', line: 'INCENTIVE' },
				statutory_opt_ins: [
					{ contribution_id: '0f8fad5b-d9cb-469f-a165-70867728950e', effect: 'INCLUDE' }
				]
			},
			{
				label: '3.0',
				line: 'OVERTIME',
				when: 'day_type == "PUBLIC_HOLIDAY"',
				take: 'hours_beyond_normal',
				price: 'ordinary_hour * 3.0',
				funnel: { above: 'limits.daily_total', line: 'INCENTIVE' },
				statutory_opt_ins: []
			}
		]
	},
	coverage: null,
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
		{ when: 'consecutive_hours > 5', owed_minutes: 30, counts_as_worked_time: false },
		{
			when: 'overtime_hours > 2',
			owed_minutes: 'overtime_hours > 4 ? 60 : 30',
			counts_as_worked_time: null
		}
	],
	weekly_rest_rule: { max_consecutive_work_days: 6, discharged_by: 'REST' },
	holiday_rest_precedence: 'SUBSTITUTE'
};

test('a Nihon-shaped rule set parses', () => {
	const rules = decode(nihon);
	assert.equal(rules.rates.bands.length, 2);
	assert.equal(rules.limits[0]?.key, 'daily_total');
	assert.equal(rules.breaks[1]?.owed_minutes, 'overtime_hours > 4 ? 60 : 30');
});

test('malformed rules are refused', () => {
	for (const bad of [
		{ ...nihon, proration: '' },
		{ ...nihon, rates: { ...nihon.rates, ordinary: [{ when: '', unit: 'MONTH', divisor: 26 }] } },
		{ ...nihon, rates: { ...nihon.rates, ordinary: [{ when: '', unit: 'DAY', divisor: 0 }] } },
		{
			...nihon,
			coverage: null,
			authority: 'Employment Act 1955 ss.60, 60A, 60D',
			limits: [{ key: '', period: 'DAY', measure: 'TOTAL_WORK_HOURS', max_hours: 12 }]
		},
		{
			...nihon,
			coverage: null,
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
		{ ...nihon, rates: { ...nihon.rates, bands: [{ ...nihon.rates.bands[0], when: '' }] } },
		{
			...nihon,
			rates: {
				...nihon.rates,
				bands: [
					{
						...nihon.rates.bands[0],
						statutory_opt_ins: [{ contribution_id: 'not-a-uuid', effect: 'INCLUDE' }]
					}
				]
			}
		},
		{ ...nihon, holiday_rest_precedence: 'NONE' },
		// CEL is compiled at write: a misspelt member or the wrong result type is refused here,
		// not when a payroll prices the month the version governs (RFC 0001 §7, acceptance 1).
		{
			...nihon,
			rates: {
				...nihon.rates,
				bands: [{ ...nihon.rates.bands[0], when: 'day_typo == "ORDINARY"' }]
			}
		},
		{
			...nihon,
			rates: { ...nihon.rates, bands: [{ ...nihon.rates.bands[0], take: 'roster_code' }] }
		},
		{
			...nihon,
			rates: { ...nihon.rates, bands: [{ ...nihon.rates.bands[0], price: 'ordinary_hour * "x"' }] }
		},
		{
			...nihon,
			rates: {
				...nihon.rates,
				bands: [
					{
						...nihon.rates.bands[0],
						funnel: { above: 'limits.no_such_limit', line: 'INCENTIVE' }
					}
				]
			}
		},
		{
			...nihon,
			rates: { ...nihon.rates, ordinary: [{ when: 'terms.nope > 1', unit: 'HOUR', divisor: 173 }] }
		},
		{
			...nihon,
			breaks: [
				{ when: 'consecutive_hours_typo > 5', owed_minutes: 30, counts_as_worked_time: false }
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
