/**
 * The ordinary rate of pay, and one day's wages. The divisor is statutory, on
 * `work_rules.ordinary_divisor_days` (MY EA s.60I 26 days; ID PP 35/2021 173 hours; SG 12 × monthly
 * ÷ (52 × 44)): one expression over the person in days per month, so the PH 261/313 factor can
 * follow the week shape; a statute in hours is hours over the contract's normal day. Rates keep
 * their full quotient until the payroll amount is rounded; normal hours are the contract's weekly
 * hours over its working days.
 */

import type { Work } from './configuration.js';
import type { PersonContext } from './eligibility.js';
import type { MoneyValue } from './rounding.js';
import { decodeNumber } from '../../wire.js';

import { monthDays } from './dates.js';
import { normalDailyHours } from './schedule.js';
import { prorationBasisFor } from './proration.js';
import { evaluateNumber, expressionEngine } from '../../../lib/expressions/evaluate.js';

const payFrequencies = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;

export type RateTerms = {
	readonly base_salary: MoneyValue;
	readonly pay_frequency: (typeof payFrequencies)[number];
	readonly ordinary_hours_per_week: number;
	readonly working_days_per_week: number;
};

/**
 * The version's divisor for this person, in days per month. A divisor that is not a positive
 * number stops the run by name rather than pricing an hour at nothing or at infinity.
 */
export function ordinaryDivisorDays(options: {
	readonly expression: string;
	readonly person: PersonContext;
	readonly employeeNumber?: string | undefined;
}): number {
	const who = options.employeeNumber ?? 'this person';
	const expression = options.expression.trim();
	if (expression === '') throw new Error('The work states no ordinary rate divisor.');
	const divisor = evaluateNumber(expressionEngine, expression, options.person);
	if (!(divisor > 0))
		throw new Error(
			`The ordinary rate divisor of ${who} evaluated to ${divisor}; ` +
				'work_rules.ordinary_divisor_days must be a positive number of days.'
		);
	return divisor;
}

/** The version and person a weekly, daily or hourly wage is taken to its month over. */
export type MonthConversion = {
	readonly work: Pick<Work, 'rate_conversions'>;
	readonly person: PersonContext;
};

const conversionKeys = {
	WEEKLY: 'weekly_to_monthly',
	DAILY: 'daily_to_monthly',
	HOURLY: 'hourly_to_monthly'
} as const;

/**
 * What one stated unit of a weekly, daily or hourly wage is as a month: the version's
 * `work_rules.rate_conversions` expression for the cadence (a statutory choice — SG and PH SSS
 * state 52 ÷ 12 weeks a month, not 365 ÷ 7 ÷ 12), over the person on the rate's own week. A
 * monthly or semi-monthly wage is already the month.
 */
export function monthlyFactor(
	frequency: RateTerms['pay_frequency'],
	week: Pick<RateTerms, 'ordinary_hours_per_week' | 'working_days_per_week'>,
	conversion: MonthConversion | undefined
): number {
	if (frequency === 'MONTHLY' || frequency === 'SEMI_MONTHLY') return 1;
	const key = conversionKeys[frequency];
	const expression = conversion?.work.rate_conversions?.[key]?.trim() ?? '';
	if (conversion == null || expression === '')
		throw new Error(
			`A ${frequency.toLowerCase()} wage needs the version's work_rules.rate_conversions.${key}.`
		);
	const factor = evaluateNumber(expressionEngine, expression, {
		...conversion.person,
		terms: {
			...conversion.person.terms,
			ordinary_hours_per_week: week.ordinary_hours_per_week,
			working_days_per_week: week.working_days_per_week
		}
	});
	if (!(factor > 0))
		throw new Error(`work_rules.rate_conversions.${key} evaluated to ${factor}; it must be positive.`);
	return factor;
}

/**
 * The monthly-equivalent contract wage.
 *
 * `base_salary` is the monthly contract wage for both monthly and semi-monthly payroll groups.
 * `pay_frequency` controls when that wage is paid; it does not change the wage's unit. Treating a
 * semi-monthly employee's stored salary as one half-period doubled every OT and absence rate.
 *
 * Weekly, daily and hourly contracts are converted by the version's `rate_conversions`, because
 * those are genuinely different wage bases.
 */
function monthlyBaseSalary(terms: RateTerms, conversion: MonthConversion | undefined): number {
	return terms.base_salary.value * monthlyFactor(terms.pay_frequency, terms, conversion);
}

/**
 * Pay for one ordinary hour; round only the completed award. `dailyMonthDays`, where the version
 * states one, takes a daily wage to its month before the divisor prices the hour (ID PP 35/2021
 * art.33(1)(b): daily × 21 ÷ 173).
 */
export function ordinaryHourlyRate(
	terms: RateTerms,
	divisorDays: number,
	dailyMonthDays?: number,
	conversion?: MonthConversion
): number {
	// DAILY and HOURLY staff are paid from the stated rate, never annualised: the rate is what the
	// contract says an hour costs. Monthly staff are untouched by this branch.
	if (terms.pay_frequency === 'HOURLY') return terms.base_salary.value;
	if (terms.pay_frequency === 'DAILY')
		return (
			(terms.base_salary.value * (dailyMonthDays == null ? 1 : dailyMonthDays / divisorDays)) /
			normalDailyHours(terms)
		);
	if (!(divisorDays > 0)) throw new Error('work_rules.ordinary_divisor_days must be positive.');
	return monthlyBaseSalary(terms, conversion) / divisorDays / normalDailyHours(terms);
}

/**
 * One day's wages — what a `day_wage` award multiplies: the monthly wage over the divisor
 * (decision E28).
 */
export function ordinaryDayWage(
	terms: RateTerms,
	divisorDays: number,
	conversion?: MonthConversion
): number {
	// A DAILY contract states its day wage; an HOURLY one states it per hour, so a day is the
	// contracted daily hours priced at that rate. Monthly staff read the divisor.
	if (terms.pay_frequency === 'DAILY') return terms.base_salary.value;
	if (terms.pay_frequency === 'HOURLY') return terms.base_salary.value * normalDailyHours(terms);
	return monthlyBaseSalary(terms, conversion) / divisorDays;
}

/** One day of withheld pay: the contract terms and the work's proration divisor over a period. */
type AbsenceDayRateOptions = {
	readonly terms: RateTerms;
	readonly work: Work;
	readonly person: PersonContext;
	readonly period: { readonly start: string; readonly end: string };
	readonly workingDaysIn: (range: { readonly start: string; readonly end: string }) => number;
};

/**
 * What one day of *withheld* pay is worth.
 *
 * Deliberately not `ordinaryDayWage`. That divisor answers "what is an extra day of work worth"
 * (EA s.60I: 26). Withholding pay for a day not worked is proration, and proration is configured in
 * exactly one place — `work_rules.proration` — so an absence follows the month's calendar days,
 * its working days, or a fixed divisor, whichever that work states.
 *
 * Conflating the two over-deducts by the ratio between the divisors: 31/26 in a 31-day Malaysian
 * month, about 19% on every employee with unpaid leave.
 *
 * Round the completed deduction in the payroll currency, not this intermediate rate.
 */
export function absenceDayRate(options: AbsenceDayRateOptions): number {
	const monthly = monthlyBaseSalary(options.terms, options);
	const proration = prorationBasisFor(options.work, options.person);
	switch (proration.by) {
		case 'CALENDAR_DAYS':
			return monthly / (proration.days ?? monthDays(options.period.start));
		case 'WORKING_DAYS': {
			const days = options.workingDaysIn(options.period);
			if (!(days > 0))
				throw new Error(
					`The period ${options.period.start}..${options.period.end} has no working days, so an ` +
						'absence in it cannot be priced.'
				);
			return monthly / days;
		}
		case 'FIXED_DAYS': {
			if (!(proration.days > 0))
				throw new Error('A FIXED_DAYS proration basis needs a positive divisor.');
			return monthly / proration.days;
		}
	}
	throw new Error(`Unsupported proration basis: ${Reflect.get(proration, 'by')}`);
}
