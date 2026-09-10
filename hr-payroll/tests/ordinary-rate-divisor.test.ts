/**
 * The divisor an extra day of work is priced over.
 *
 * DOLE states two annual day counts: 261 for a five-day week and 313 for a six-day one. A work row
 * carries one divisor, so the seed states the five-day 261/12 = 21.75 and the engine selects the
 * six-day alternative from the employee's own working week — which is employee-level law and
 * cannot be a company-wide value.
 *
 * That selection had no test at all. The Philippine bank tenant rosters `REST-OPSPH-DAYx6`, a
 * six-day pattern, on 13 of its 23 contracts, and nine of those are paid ₱15,650 — which is
 * ₱600.00 × 313 ÷ 12 to the centavo, the CALABARZON floor built on the six-day factor. Priced over
 * 21.75 the same salary yields ₱719.54 a day: 19.92% too much on every overtime, rest-day, holiday
 * and night hour those employees work.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ordinaryDayWage,
	type RateTerms
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';

const PH_WORK = { jurisdiction_code: 'PH', proration: { by: 'FIXED_DAYS', days: 21.75 } } as never;
const MY_WORK = { jurisdiction_code: 'MY', proration: { by: 'FIXED_DAYS', days: 26 } } as never;
/** The seeded Philippine row: a day, over the five-day 261/12. */
const PER_DAY = { per: 'DAY', divisor: 21.75 } as const;

const terms = (hoursPerWeek: number, daysPerWeek: number, salary = 15_650): RateTerms => ({
	base_salary: { value: salary, currency: 'PHP' },
	pay_frequency: 'SEMI_MONTHLY',
	ordinary_hours_per_week: hoursPerWeek,
	working_days_per_week: daysPerWeek
});

test('a six-day Philippine week prices a day over 313/12, not 261/12', () => {
	// 15,650 ÷ (313/12) = 600.00 exactly — the CALABARZON daily floor the salary was built from.
	assert.equal(ordinaryDayWage(terms(48, 6), PH_WORK, PER_DAY), 600);
	// The same salary over the seeded 21.75 is what it used to pay.
	assert.equal(ordinaryDayWage(terms(40, 5), PH_WORK, PER_DAY), 719.54);
	assert.ok(719.54 / 600 - 1 > 0.19, 'the gap is a fifth of every premium hour');
});

test('the alternative is Philippine, and only above forty ordinary hours', () => {
	// Exactly forty hours is not "more than forty": a five-day week keeps the stated divisor even
	// when its days are long.
	assert.equal(ordinaryDayWage(terms(40, 4), PH_WORK, PER_DAY), 719.54);
	// A six-day week elsewhere keeps its own jurisdiction's divisor; 313 is not a general rule.
	assert.equal(ordinaryDayWage(terms(48, 6, 15_650), MY_WORK, { per: 'DAY', divisor: 26 }), 601.92);
});

test('a monthly-paid employee keeps 365/12, whatever their roster', () => {
	// The Philippine seed states two rows: monthly-paid staff over 365/12 = 30.4167, everyone else
	// over the five-day 21.75. A monthly-paid employee is paid for all 365 days, so the
	// 261-against-313 question is not theirs — and the bank rosters one of them on the six-day
	// pattern, so substituting into their row is a live 16.6% overpayment on every premium hour.
	const monthlyPaid = { per: 'DAY', divisor: 30.4167 } as const;
	assert.equal(ordinaryDayWage(terms(48, 6), PH_WORK, monthlyPaid), 514.52);
	assert.equal(
		ordinaryDayWage(terms(40, 5), PH_WORK, monthlyPaid),
		514.52,
		'and the roster does not move it either way'
	);
});
