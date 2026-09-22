/**
 * The divisor an extra day of work is priced over, chosen by the Work's own rate rows.
 *
 * DOLE states two annual day counts: 261 for a five-day week and 313 for a six-day one. That is
 * employee-level law — one company can roster both — so it cannot be a single company-wide
 * divisor. It used to be a branch in the engine: `countryOf(work.jurisdiction_code) === 'PH'`
 * substituting 313/12 when the employee's week exceeded forty hours.
 *
 * A jurisdiction naming itself in engine code is the shape this template exists to avoid, and
 * nothing here needed it. `ordinary_rate` is already a predicate list, so the Work states one row
 * per week shape and the grammar picks between them:
 *
 * ```
 * terms.paid_rest_days                   365 / 12  paid for all 365 days
 * terms.ordinary_hours_per_week > 40      313 / 12  the six-day factor
 * (everyone)                              261 / 12  the five-day factor
 * ```
 *
 * The order carries the rule the branch used to: a monthly-paid employee keeps 365/12 whatever
 * their roster, because the 261-against-313 question is a daily-paid one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ordinaryDayWage,
	ordinaryHourlyRate,
	ordinaryDivisorDays,
	type RateTerms
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';

/** The Philippine Work as the bank seeds it, not a fixture invented here. */
const PH_WORK = (
	JSON.parse(
		readFileSync(
			fileURLToPath(new URL('../seed/jurisdiction/PH/jurisdiction_settings.json', import.meta.url)),
			'utf8'
		)
	)[0] as { work_rules: { ordinary_divisor_days: string } }
).work_rules;

/**
 * A complete person, not a convenient one. `verify-fixture-shapes.mjs` reads every field the engine
 * reads and asks whether the fixture supplies it, because a fixture describing an imagined shape
 * makes a green suite prove a false premise. The rate rows here turn on two of these members; the
 * rest are stated because the engine reads them.
 */
const person = (hoursPerWeek: number, daysPerWeek: number, paidRestDays: boolean) =>
	personContext({
		employee: {
			gender: null,
			date_of_birth: '1985-04-02',
			nationality: 'PH',
			marital_status: 'SINGLE',
			spouse_status: 'NONE',
			solo_parent: false,
			race: null,
			religion: null
		},
		employment: { service_start: '2020-01-01' },
		terms: {
			residency_status: 'CITIZEN',
			employment_type: 'PERMANENT',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			base_salary: { value: 15_650, currency: 'PHP' },
			department: 'Production',
			payroll_group: 'BI-MONTHLY',
			paid_rest_days: paidRestDays,
			grade: null,
			residency_since: null
		},
		week: { ordinary_hours_per_week: hoursPerWeek, working_days_per_week: daysPerWeek },
		children: [],
		company: { region: 'CALABARZON' },
		period: { working_days: 26 },
		asOf: '2026-06-30'
	} as never);

const terms = (hoursPerWeek: number, daysPerWeek: number, salary = 15_650): RateTerms => ({
	base_salary: { value: salary, currency: 'PHP' },
	pay_frequency: 'SEMI_MONTHLY',
	ordinary_hours_per_week: hoursPerWeek,
	working_days_per_week: daysPerWeek
});

const dayWageOf = (hoursPerWeek: number, daysPerWeek: number, paidRestDays = false) => {
	const divisor = ordinaryDivisorDays({
		expression: PH_WORK.ordinary_divisor_days,
		person: person(hoursPerWeek, daysPerWeek, paidRestDays),
		employeeNumber: 'OPSPH000'
	});
	return { divisor, wage: ordinaryDayWage(terms(hoursPerWeek, daysPerWeek), divisor) };
};

test('a six-day Philippine week is priced over 313/12, chosen by the Work', () => {
	// 15,650 ÷ (313/12) = 600.00 — the CALABARZON daily floor the salary was built from, which is
	// what Wage Order IVA-22 tranche 2 sets from 1 April 2026.
	assert.deepEqual(dayWageOf(48, 6), { divisor: 313 / 12, wage: 600 });
});

test('a five-day week keeps 261/12, and forty hours is not more than forty', () => {
	assert.deepEqual(dayWageOf(40, 5), { divisor: 261 / 12, wage: 15_650 / (261 / 12) });
	// Four long days is still forty hours: the predicate reads the week, not the day.
	assert.deepEqual(dayWageOf(40, 4), { divisor: 261 / 12, wage: 15_650 / (261 / 12) });
});

test('a monthly-paid employee keeps 365/12, whatever their roster', () => {
	// They are paid for all 365 days, so the 261-against-313 question is not theirs. The bank
	// rosters one of them on the six-day pattern, so the ordering of the rows is load-bearing.
	assert.deepEqual(dayWageOf(48, 6, true), { divisor: 365 / 12, wage: 15_650 / (365 / 12) });
	assert.deepEqual(dayWageOf(40, 5, true), { divisor: 365 / 12, wage: 15_650 / (365 / 12) });
});

test('the Work states every week shape it rosters, so no person falls through', () => {
	// `ordinaryDivisorDays` refuses by name rather than pricing an hour at nothing, and the
	// expression's final arm is everyone. This is the check that the Philippine seed keeps it.
	assert.match(PH_WORK.ordinary_divisor_days, /: \(261\.0 \/ 12\.0\)$/);
	assert.doesNotThrow(() => dayWageOf(0, 0, false));
});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code}: weekly ordinary pay retains monthly allowance units (EA 60I)`, () => {
		const original = person(40, 5);
		const subject = {
			...original,
			terms: {
				...original.terms,
				basic_salary: 601,
				monthly_wage: 861,
				fixed_allowances: 260,
				pay_frequency: 'WEEKLY'
			}
		};
		const weekly = { ...terms(40, 5, 601), pay_frequency: 'WEEKLY' as const };
		for (const version of settingsVersions(code)) {
			const divisor = ordinaryDivisorDays({
				expression: version.work_rules.ordinary_divisor_days,
				person: subject
			});
			// Weekly basic 601 / 6 plus monthly normal-hours allowance 260 / 26.
			assert.ok(Math.abs(ordinaryDayWage(weekly, divisor) - (601 / 6 + 10)) < 1e-10);
			assert.ok(Math.abs(ordinaryHourlyRate(weekly, divisor) - (601 / 6 + 10) / 8) < 1e-10);
		}
	});
