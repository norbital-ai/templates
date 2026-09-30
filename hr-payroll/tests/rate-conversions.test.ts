/**
 * LIT-01: the weeks in a month and the gross hourly rate are the version's, never the engine's.
 * `work_rules.rate_conversions` takes a weekly, daily or hourly wage to its month;
 * `work_rules.hourly_rate` and `hourly_rate_excluded` price an hour of leave. Every figure below is
 * worked by hand from the seeded expressions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	monthlyFactor,
	ordinaryDayWage,
	ordinaryDivisorDays
} from '../src/lib/payroll/run/ordinary-rate.ts';
import { evaluatePersonNumber, personContext } from '../src/lib/payroll/run/eligibility.ts';
import { cumulativeHistory } from '../src/lib/payroll/statutory-history.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';

const LINEAGES = [
	'SG',
	'PH',
	'MY',
	'MY-nihon',
	'ID',
	'TH',
	'VN',
	'CN-shanghai',
	'CN-kunming',
	'TW',
	'JP'
] as const;

const person = (
	frequency: string,
	basic: number,
	hours: number,
	days: number,
	fixedAllowances = 0
) =>
	personContext({
		employee: null,
		employment: { service_start: '2020-01-01' },
		terms: { base_salary: basic, currency: 'XXX', pay_frequency: frequency },
		fixedAllowances,
		week: { ordinary_hours_per_week: hours, working_days_per_week: days },
		asOf: '2026-06-30'
	} as never);

test('every seeded version states its rate conversions: 52 ÷ 12 weeks, days × 52 ÷ 12, hours × 52 ÷ 12', () => {
	for (const code of LINEAGES)
		for (const version of settingsVersions(code)) {
			const conversion = { work: version.work_rules, person: person('WEEKLY', 0, 40, 5) };
			const week = { ordinary_hours_per_week: 40, working_days_per_week: 5 };
			assert.equal(monthlyFactor('WEEKLY', week, conversion), 52 / 12, code);
			// 5 days × 52 ÷ 12 = 21.666…; 40 hours × 52 ÷ 12 = 173.333…. PH and VN state their own day.
			if (code !== 'PH' && code !== 'VN')
				assert.equal(monthlyFactor('DAILY', week, conversion), (5 * 52) / 12, code);
			assert.equal(monthlyFactor('HOURLY', week, conversion), (40 * 52) / 12, code);
			assert.equal(monthlyFactor('MONTHLY', week, conversion), 1, code);
		}
});

test('PH takes a day to its month on the DOLE factor, VN on the month’s normal working days', () => {
	// DOLE Handbook ch.2 §E / NWPC EMR: daily × 261 ÷ 12 on a five-day week, × 313 ÷ 12 on six.
	for (const version of settingsVersions('PH')) {
		const conversion = { work: version.work_rules, person: person('DAILY', 0, 40, 5) };
		const days = (working_days_per_week: number) =>
			monthlyFactor('DAILY', { ordinary_hours_per_week: 40, working_days_per_week }, conversion);
		assert.equal(days(5), 261 / 12);
		assert.equal(days(6), 313 / 12);
	}
	// Decree 293/2025 art.4(3): a daily wage × the month's normal working days (22 here).
	for (const version of settingsVersions('VN')) {
		const subject = personContext({
			employee: null,
			employment: { service_start: '2020-01-01' },
			terms: { base_salary: 0, currency: 'VND', pay_frequency: 'DAILY' },
			week: { ordinary_hours_per_week: 40, working_days_per_week: 5 },
			period: { working_days: 22 },
			asOf: '2026-06-30'
		} as never);
		assert.equal(
			monthlyFactor(
				'DAILY',
				{ ordinary_hours_per_week: 40, working_days_per_week: 5 },
				{ work: version.work_rules, person: subject }
			),
			22
		);
	}
});

test('a weekly wage without the version’s conversion is refused, never priced on a built-in 52 ÷ 12', () => {
	const week = { ordinary_hours_per_week: 40, working_days_per_week: 5 };
	assert.throws(
		() => monthlyFactor('WEEKLY', week, { work: {}, person: person('WEEKLY', 0, 40, 5) }),
		/rate_conversions\.weekly_to_monthly/
	);
	assert.equal(monthlyFactor('SEMI_MONTHLY', week, undefined), 1);
});

test('SG weekly S$600 on a five-day week: month 2,600, day 120', () => {
	// 600 × 52 ÷ 12 = 2,600 a month; the SG divisor 52 × 5 ÷ 12 = 21.666… days; 2,600 ÷ 21.666… = 120.
	for (const version of settingsVersions('SG')) {
		const subject = person('WEEKLY', 600, 44, 5);
		const divisor = ordinaryDivisorDays({
			expression: version.work_rules.ordinary_divisor_days,
			person: subject
		});
		const day = ordinaryDayWage(
			{
				base_salary: { value: 600, currency: 'SGD' },
				pay_frequency: 'WEEKLY',
				ordinary_hours_per_week: 44,
				working_days_per_week: 5
			},
			divisor,
			{ work: version.work_rules, person: subject }
		);
		assert.ok(Math.abs(day - 120) < 1e-9, `${day}`);
	}
});

test('SG hourly leave rate: 12 × (basic + gross allowances) ÷ (52 × weekly hours), per cadence', () => {
	for (const version of settingsVersions('SG')) {
		const rule = version.work_rules.hourly_rate;
		// Monthly 1,040 + 260 on 20 hours: 12 × 1,300 ÷ 1,040 = 15.
		assert.equal(evaluatePersonNumber(rule, person('MONTHLY', 1_040, 20, 5, 260)), 15);
		// Daily 80 on an 8-hour day: 10. Weekly 400 over 40 hours: 10. Hourly 12: 12.
		assert.equal(evaluatePersonNumber(rule, person('DAILY', 80, 40, 5)), 10);
		assert.equal(evaluatePersonNumber(rule, person('WEEKLY', 400, 40, 5)), 10);
		assert.equal(evaluatePersonNumber(rule, person('HOURLY', 12, 40, 5)), 12);
		// The excluded allowance's hour: 12 × 260 ÷ (52 × 20) = 3.
		assert.equal(
			evaluatePersonNumber(
				version.work_rules.hourly_rate_excluded,
				person('MONTHLY', 0, 20, 5, 260)
			),
			3
		);
	}
});

test('TW hourly leave rate is the month ÷ 30 ÷ the normal day (TW-LEAVE-03-2)', () => {
	for (const version of settingsVersions('TW')) {
		// 45,000 ÷ 30 = 1,500 a day; ÷ 8 hours = 187.50 an hour, so two hours are 375.
		assert.equal(
			evaluatePersonNumber(version.work_rules.hourly_rate, person('MONTHLY', 45_000, 40, 5)),
			187.5
		);
	}
});

test('a weekly opening converts to months on the version’s weeks a month', () => {
	// Thirteen weekly periods at 52 ÷ 12 weeks a month are three months.
	const history = cumulativeHistory({
		periods: [],
		openings: new Map([
			[
				'X',
				{
					base: 0,
					employee: 0,
					employer: 0,
					payroll_periods: 13,
					payroll_frequency: 'WEEKLY' as const
				}
			]
		]),
		frequency: 'MONTHLY',
		weeksPerMonth: () => 52 / 12
	});
	assert.ok(Math.abs(history.get('X')!.periods - 3) < 1e-12);
	assert.throws(
		() =>
			cumulativeHistory({
				periods: [],
				openings: new Map([
					[
						'X',
						{
							base: 0,
							employee: 0,
							employer: 0,
							payroll_periods: 13,
							payroll_frequency: 'WEEKLY' as const
						}
					]
				]),
				frequency: 'MONTHLY'
			}),
		/weeks a month/
	);
});
