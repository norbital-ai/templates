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
 * terms.payroll_group == "MONTHLY"        30.4167   paid for all 365 days
 * terms.ordinary_hours_per_week > 40      26.0833   313 / 12, the six-day factor
 * (everyone)                              21.75     261 / 12, the five-day factor
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
	resolveOrdinaryRate,
	type RateTerms
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

/** The Philippine Work as the bank seeds it, not a fixture invented here. */
const PH_WORK = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('fixtures/statutory/PH/work_catalogue.json', import.meta.url)),
		'utf8'
	)
)[0];

/**
 * A complete person, not a convenient one. `verify-fixture-shapes.mjs` reads every field the engine
 * reads and asks whether the fixture supplies it, because a fixture describing an imagined shape
 * makes a green suite prove a false premise. The rate rows here turn on two of these members; the
 * rest are stated because the engine reads them.
 */
const person = (hoursPerWeek: number, daysPerWeek: number, payrollGroup: string) =>
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
		employment: { hire_date: '2020-01-01' },
		terms: {
			residency_status: 'CITIZEN',
			employment_type: 'PERMANENT',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			base_salary: { value: 15_650, currency: 'PHP' },
			department: 'Production',
			payroll_group: payrollGroup,
			grade: null,
			residency_since: null
		},
		week: { ordinary_hours_per_week: hoursPerWeek, working_days_per_week: daysPerWeek },
		children: [],
		company: { region: 'CALABARZON' },
		asOf: '2026-06-30'
	} as never);

const terms = (hoursPerWeek: number, daysPerWeek: number, salary = 15_650): RateTerms => ({
	base_salary: { value: salary, currency: 'PHP' },
	pay_frequency: 'SEMI_MONTHLY',
	ordinary_hours_per_week: hoursPerWeek,
	working_days_per_week: daysPerWeek
});

const dayWageOf = (hoursPerWeek: number, daysPerWeek: number, payrollGroup = 'BI-MONTHLY') => {
	const rate = resolveOrdinaryRate({
		rows: PH_WORK.ordinary_rate,
		person: person(hoursPerWeek, daysPerWeek, payrollGroup),
		workingDays: () => 26,
		employeeNumber: 'OPSPH000'
	});
	return {
		divisor: rate.divisor,
		wage: ordinaryDayWage(terms(hoursPerWeek, daysPerWeek), PH_WORK, rate)
	};
};

test('a six-day Philippine week is priced over 313/12, chosen by the Work', () => {
	// 15,650 ÷ (313/12) = 600.00 — the CALABARZON daily floor the salary was built from, which is
	// what Wage Order IVA-22 tranche 2 sets from 1 April 2026.
	assert.deepEqual(dayWageOf(48, 6), { divisor: 26.0833, wage: 600 });
});

test('a five-day week keeps 261/12, and forty hours is not more than forty', () => {
	assert.deepEqual(dayWageOf(40, 5), { divisor: 21.75, wage: 719.54 });
	// Four long days is still forty hours: the predicate reads the week, not the day.
	assert.deepEqual(dayWageOf(40, 4), { divisor: 21.75, wage: 719.54 });
});

test('a monthly-paid employee keeps 365/12, whatever their roster', () => {
	// They are paid for all 365 days, so the 261-against-313 question is not theirs. The bank
	// rosters one of them on the six-day pattern, so the ordering of the rows is load-bearing.
	assert.deepEqual(dayWageOf(48, 6, 'MONTHLY'), { divisor: 30.4167, wage: 514.52 });
	assert.deepEqual(dayWageOf(40, 5, 'MONTHLY'), { divisor: 30.4167, wage: 514.52 });
});

test('the Work states every week shape it rosters, so no person falls through', () => {
	// `resolveOrdinaryRate` refuses by name rather than pricing an hour at nothing, and the last
	// row is normally everyone. This is the check that the Philippine seed keeps that last row.
	assert.equal(PH_WORK.ordinary_rate.at(-1).eligibility, '');
	assert.doesNotThrow(() => dayWageOf(0, 0, ''));
});
