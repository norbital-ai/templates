/**
 * The ordinary rate of pay, and one day's wages.
 *
 * The divisor is statutory and lives on `work_catalogue.ordinary_rate` — Malaysia's 26 is EA s.60I,
 * Indonesia's 173 is PP 35/2021, Singapore's 190.67 is 12 × monthly ÷ (52 × 44). A company using
 * 30 where the statute says 26 underpays every overtime hour by 15%, which is why it is not a
 * company setting, and why the overtime rate is this rate and not a company-chosen alternative.
 *
 * Two details matter for parity:
 *
 * - the numerator is the **unprorated** contract salary, so a mid-month joiner's overtime is priced
 *   at their full-month rate, not their part-month pay (decision E4);
 * - the rate is rounded to cents **before** it is multiplied by hours, never after.
 *
 * Normal hours in an overtime-rate day are the employment's contractual weekly hours divided by
 * its contractual working days. That is the employee's normal day; a payroll-system convention
 * cannot replace it with a different schedule.
 *
 * `work_catalogue.ordinary_rate` is rows read top-down; `resolveOrdinaryRate` picks the first
 * whose predicate holds for the person and settles a `WORKING_DAYS` divisor from the month's
 * scheduled working days. Every pricing function below takes that resolved rate.
 */

import { Schema } from 'effect';
import type { Work } from './configuration.js';
import type { OrdinaryRate } from '../../../datatypes/ordinary_rate/+definition.js';
import { isEligible, type PersonContext } from './eligibility.js';
import { MoneyValueSchema } from '@norbital-ai/std/finance';
import { countryOf } from '../../../lib/jurisdiction_settings.js';
import { decodeNumber } from '@norbital-ai/std/json';

import { monthDays } from './dates.js';
import { cents } from './rounding.js';
import { normalDailyHours } from './schedule.js';

const payFrequencies = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;
const RateTermsSchema = Schema.Struct({
	base_salary: MoneyValueSchema,
	pay_frequency: Schema.Literals(payFrequencies),
	ordinary_hours_per_week: Schema.Number,
	working_days_per_week: Schema.Number
});
export type RateTerms = Schema.Schema.Type<typeof RateTermsSchema>;

/** One ordinary-rate row with its divisor settled to a number. */
type ResolvedOrdinaryRate = { readonly per: 'DAY' | 'HOUR'; readonly divisor: number };

/**
 * The first row whose predicate holds for the person. `WORKING_DAYS` asks the caller for the
 * month's scheduled working days; a person no row covers, or a month with no working days under
 * that divisor, stops the run by name rather than pricing an hour at nothing.
 */
export function resolveOrdinaryRate(options: {
	readonly rows: OrdinaryRate | null | undefined;
	readonly person: PersonContext;
	readonly workingDays: () => number;
	readonly employeeNumber?: string;
}): ResolvedOrdinaryRate {
	const rows = options.rows ?? [];
	if (rows.length === 0) throw new Error('The work states no ordinary rate.');
	const row = rows.find((candidate) => isEligible(candidate.eligibility, options.person));
	const who = options.employeeNumber ?? 'this person';
	if (row == null)
		throw new Error(`No ordinary rate row covers ${who}; the last row is normally everyone.`);
	if (row.divisor === 'WORKING_DAYS') {
		const days = options.workingDays();
		if (!(days > 0))
			throw new Error(
				`The ordinary rate of ${who} divides by the month's working days, and the month has none.`
			);
		return { per: row.per, divisor: days };
	}
	return { per: row.per, divisor: decodeNumber(row.divisor) };
}

/**
 * The Philippines uses 261 annual days for a five-day week and 313 for a six-day week. The
 * work row stores the common monthly divisor (261 / 12 = 21.75); the employee's stated
 * working week selects the statutory 313-day alternative when it exceeds forty ordinary hours.
 *
 * This is employee-level law, so it cannot be represented by replacing the work's one
 * divisor with a company-wide value.
 */
function ordinaryRateDivisor(terms: RateTerms, work: Work, rate: ResolvedOrdinaryRate): number {
	if (
		countryOf(work.jurisdiction_code) === 'PH' &&
		decodeNumber(terms.ordinary_hours_per_week) > 40 &&
		rate.per === 'DAY'
	)
		return 313 / 12;
	return rate.divisor;
}

/**
 * The monthly-equivalent contract wage.
 *
 * `base_salary` is the monthly contract wage for both monthly and semi-monthly payroll groups.
 * `pay_frequency` controls when that wage is paid; it does not change the wage's unit. Treating a
 * semi-monthly employee's stored salary as one half-period doubled every OT and absence rate.
 *
 * Weekly, daily and hourly contracts are converted because those are genuinely different wage
 * bases. They still need their own proration story before those populations are trusted.
 */
function monthlyBaseSalary(terms: RateTerms): number {
	const value = decodeNumber(terms.base_salary.value);
	const hoursPerDay =
		decodeNumber(terms.ordinary_hours_per_week) / decodeNumber(terms.working_days_per_week);
	switch (terms.pay_frequency) {
		case 'MONTHLY':
			return value;
		case 'SEMI_MONTHLY':
			return value;
		case 'WEEKLY':
			return (value * 52) / 12;
		case 'DAILY':
			return (value * decodeNumber(terms.working_days_per_week) * 52) / 12;
		case 'HOURLY':
			return (value * hoursPerDay * decodeNumber(terms.working_days_per_week) * 52) / 12;
	}
}

/** Pay for one ordinary hour, rounded to cents before any multiplication. */
export function ordinaryHourlyRate(
	terms: RateTerms,
	work: Work,
	rate: ResolvedOrdinaryRate
): number {
	// DAILY and HOURLY staff are paid from the stated rate, never annualised: the rate is what the
	// contract says an hour costs. Monthly staff are untouched by this branch.
	if (terms.pay_frequency === 'HOURLY') return cents(decodeNumber(terms.base_salary.value));
	if (terms.pay_frequency === 'DAILY')
		return cents(decodeNumber(terms.base_salary.value) / normalDailyHours(terms));
	const divisor = ordinaryRateDivisor(terms, work, rate);
	if (!(divisor > 0)) throw new Error('work_catalogue.ordinary_rate.divisor must be positive.');
	const monthly = monthlyBaseSalary(terms);
	return rate.per === 'HOUR'
		? cents(monthly / divisor)
		: cents(monthly / divisor / normalDailyHours(terms));
}

/**
 * One day's wages — what a `DAY_WAGE_MULTIPLE` overtime award multiplies.
 *
 * On a days-per-month basis this is the divisor itself; on an hours-per-month basis there is no day
 * in the statute at all, so a day is the contracted daily hours priced at the hourly rate
 * (decision E28).
 */
export function ordinaryDayWage(terms: RateTerms, work: Work, rate: ResolvedOrdinaryRate): number {
	// A DAILY contract states its day wage; an HOURLY one states it per hour, so a day is the
	// contracted daily hours priced at that rate. Monthly staff read the divisor as before.
	if (terms.pay_frequency === 'DAILY') return cents(decodeNumber(terms.base_salary.value));
	if (terms.pay_frequency === 'HOURLY')
		return cents(decodeNumber(terms.base_salary.value) * normalDailyHours(terms));
	const divisor = ordinaryRateDivisor(terms, work, rate);
	const monthly = monthlyBaseSalary(terms);
	return rate.per === 'HOUR'
		? cents((monthly * normalDailyHours(terms)) / divisor)
		: cents(monthly / divisor);
}

/** One day of withheld pay: the contract terms and the work's proration divisor over a period. */
type AbsenceDayRateOptions = {
	readonly terms: RateTerms;
	readonly work: Work;
	readonly period: { readonly start: string; readonly end: string };
	readonly workingDaysIn: (range: { readonly start: string; readonly end: string }) => number;
};

/**
 * What one day of *withheld* pay is worth.
 *
 * Deliberately not `ordinaryDayWage`. That divisor answers "what is an extra day of work worth"
 * (EA s.60I: 26). Withholding pay for a day not worked is proration, and proration is configured in
 * exactly one place — `work_catalogue.proration` — so an absence follows the month's calendar days,
 * its working days, or a fixed divisor, whichever that work states.
 *
 * Conflating the two over-deducts by the ratio between the divisors: 31/26 in a 31-day Malaysian
 * month, about 19% on every employee with unpaid leave.
 *
 * The rate is rounded to the cent **before** the day count multiplies it. Rounding after instead
 * moves the result by a cent or two on most absences, which is the difference between reproducing
 * the source system and merely being close to it.
 */
export function absenceDayRate(options: AbsenceDayRateOptions): number {
	const monthly = monthlyBaseSalary(options.terms);
	const proration = options.work.proration;
	if (proration == null) throw new Error('The work states no proration basis.');
	switch (proration.by) {
		case 'CALENDAR_DAYS':
			return cents(monthly / monthDays(options.period.start));
		case 'WORKING_DAYS': {
			const days = options.workingDaysIn(options.period);
			if (!(days > 0))
				throw new Error(
					`The period ${options.period.start}..${options.period.end} has no working days, so an ` +
						'absence in it cannot be priced.'
				);
			return cents(monthly / days);
		}
		case 'FIXED_DAYS': {
			if (!(proration.days > 0))
				throw new Error('A FIXED_DAYS proration basis needs a positive divisor.');
			return cents(monthly / proration.days);
		}
	}
	throw new Error(`Unsupported proration basis: ${Reflect.get(proration, 'by')}`);
}
