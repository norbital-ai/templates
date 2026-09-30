import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contractClasses, statedOrdinaryRate } from '../src/lib/payroll/run/ordinary-rate.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { workRulesValueSchema } from '../src/lib/datatypes/work_rules.ts';
import { Schema } from 'effect';

const person = (
	terms: { base_salary: number; pay_frequency: string },
	fixedAllowances: number,
	week: { ordinary_hours_per_week: number; working_days_per_week: number }
) =>
	personContext({
		employee: null,
		employment: { service_start: '2024-01-01' },
		terms,
		fixedAllowances,
		week,
		asOf: '2026-03-31'
	});

const FULL_WEEK = { ordinary_hours_per_week: 40, working_days_per_week: 5 };

test('contract.classes sums each recurring item under its code and every class it counts toward', () => {
	assert.deepEqual(
		contractClasses([
			{ code: 'POSITION', counts_toward: ['PREMIUM_BASE', 'WAGES'], amount: 20_000 },
			{ code: 'SKILL', counts_toward: ['PREMIUM_BASE'], amount: 5_000 },
			{ code: 'FAMILY', counts_toward: ['WAGES'], amount: 15_000 },
			{ code: 'COMMUTING', amount: 10_000 }
		]),
		{
			POSITION: 20_000,
			PREMIUM_BASE: 25_000,
			WAGES: 35_000,
			SKILL: 5_000,
			FAMILY: 15_000,
			COMMUTING: 10_000
		}
	);
});

test('a premium base names the classes it keeps: family and commuting allowances stay out', () => {
	// Hand-computed: (300,000 basic + 20,000 position + 5,000 skill) / 162.5 monthly scheduled hours
	// = 2,000 an hour; the day is 8 of them = 16,000. Family (15,000) and commuting (10,000) carry
	// no PREMIUM_BASE tag, so they never enter the base.
	const work = {
		ordinary_rate: {
			hour: '(terms.basic_salary + contract.classes.PREMIUM_BASE) / 162.5',
			day: '(terms.basic_salary + contract.classes.PREMIUM_BASE) / 162.5 * 8.0'
		}
	};
	const classes = contractClasses([
		{ code: 'POSITION', counts_toward: ['PREMIUM_BASE'], amount: 20_000 },
		{ code: 'SKILL', counts_toward: ['PREMIUM_BASE'], amount: 5_000 },
		{ code: 'FAMILY', amount: 15_000 },
		{ code: 'COMMUTING', amount: 10_000 }
	]);
	const rate = statedOrdinaryRate(
		work,
		person({ base_salary: 300_000, pay_frequency: 'MONTHLY' }, 50_000, FULL_WEEK),
		classes
	);
	assert.deepEqual(rate, { hour: 2_000, day: 16_000 });
	// A contract with no tagged item reads the class as 0: 300,000 / 162.5.
	assert.deepEqual(
		statedOrdinaryRate(
			work,
			person({ base_salary: 300_000, pay_frequency: 'MONTHLY' }, 0, FULL_WEEK),
			{}
		),
		{ hour: 300_000 / 162.5, day: (300_000 / 162.5) * 8 }
	);
});

test('no stated rate leaves the divisor to price it; a negative rate stops the run by name', () => {
	const someone = person({ base_salary: 1_000, pay_frequency: 'MONTHLY' }, 0, FULL_WEEK);
	assert.equal(statedOrdinaryRate({}, someone, {}), null);
	assert.throws(
		() =>
			statedOrdinaryRate(
				{ ordinary_rate: { hour: '0.0 - terms.basic_salary', day: '1.0' } },
				someone,
				{},
				'E1'
			),
		/ordinary hour of E1 evaluated to -1000/
	);
});

test('the seeded daily-wage month (× 21 or × 25, then 1/173) matches the divisor it replaced', () => {
	const versions = JSON.parse(
		readFileSync(
			new URL('../seed/jurisdiction/ID/jurisdiction_settings.json', import.meta.url),
			'utf8'
		)
	) as { work_rules: { ordinary_rate: { hour: string; day: string } } }[];
	for (const version of versions) {
		const work = version.work_rules;
		const rate = (
			terms: { base_salary: number; pay_frequency: string },
			fixed: number,
			week: typeof FULL_WEEK
		) => statedOrdinaryRate(work, person(terms, fixed, week), {});
		// Monthly 5,000,000 + 1,000,000 fixed on 40/5: the hour is the monthly wage / 173 and the
		// day 8 of them (the old divisor 173/8 × 5/6 = 18.0208…; 5,000,000 / 18.0208… / 8).
		const monthly = rate(
			{ base_salary: 5_000_000, pay_frequency: 'MONTHLY' },
			1_000_000,
			FULL_WEEK
		)!;
		assert.ok(Math.abs(monthly.hour - 6_000_000 / 173) < 1e-6);
		assert.ok(Math.abs(monthly.day - (8 * 6_000_000) / 173) < 1e-6);
		// Daily 200,000 + 600,000 fixed on a six-day 48-hour week: × 25 then 1/173; the day is the wage.
		const sixDay = rate({ base_salary: 200_000, pay_frequency: 'DAILY' }, 600_000, {
			ordinary_hours_per_week: 48,
			working_days_per_week: 6
		})!;
		assert.ok(Math.abs(sixDay.hour - (25 * 800_000) / 173) < 1e-6);
		assert.equal(sixDay.day, 200_000);
		// A five-day week takes the daily wage × 21.
		const fiveDay = rate({ base_salary: 200_000, pay_frequency: 'DAILY' }, 0, FULL_WEEK)!;
		assert.ok(Math.abs(fiveDay.hour - (21 * 200_000) / 173) < 1e-6);
		// Hourly is the stated rate; its day the normal day's hours of it.
		assert.deepEqual(rate({ base_salary: 30_000, pay_frequency: 'HOURLY' }, 0, FULL_WEEK), {
			hour: 30_000,
			day: 240_000
		});
	}
});

test('work rules refuse an ordinary rate beside a wage-history reference, and a misspelt class root', () => {
	const decode = Schema.decodeUnknownSync(workRulesValueSchema);
	const base = JSON.parse(
		readFileSync(
			new URL('../seed/jurisdiction/ID/jurisdiction_settings.json', import.meta.url),
			'utf8'
		)
	)[0].work_rules as Record<string, unknown>;
	decode(base);
	assert.throws(
		() =>
			decode({
				...base,
				ordinary_rate_reference: {
					reference: 'PREVIOUS_WAGE_PERIOD',
					pay_frequencies: ['DAILY'],
					authority: 'x'
				}
			}),
		/ordinary_rate or ordinary_rate_reference, not both/
	);
	assert.throws(
		() => decode({ ...base, ordinary_rate: { hour: 'contracts.classes.X / 160.0', day: '1.0' } }),
		/Ordinary rate hour/
	);
});
