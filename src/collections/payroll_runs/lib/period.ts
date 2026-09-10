import { refuse } from '@norbital-ai/bolt/authoring';
/**
 * The two ranges a payroll run spans, for each cadence the company pays on.
 *
 * A company has a **pay period** — the calendar month wages belong to — and an **attendance
 * window** — the work days those wages cover. They are not the same range and they are not the
 * same length in different months.
 *
 * ```
 *   Dec                        Jan                        Feb
 * ───┼───────────┼─────────────┼───────────┼──────────────┼───►
 *    1          21             1          21              1
 *               └──── attendance window ───┘
 *                     21 Dec  →  20 Jan
 *                                           pay period 2026-01, paid 25 Jan
 * ```
 *
 * **The boundary is `[C of the previous month, C−1 of this month]`.** The plan reads cutoff day 21
 * as "the last day included" and so writes `[22 Dec, 21 Jan]`; the engine of record reads it as
 * "the first day of the new window" and computes `[21 Dec, 20 Jan]`. Both are defensible readings
 * of the same English phrase, and the second is the one that reconciles against the customer's
 * workbook, so it is the one implemented (decision E6/E19). Getting this wrong moves every 21st-of-
 * month time entry and leave day into the neighbouring run and cascades through overtime, gross,
 * every statutory band and PCB — it is the highest-blast-radius single line in the engine.
 *
 * ## Cadence, and the period grammar
 *
 * That picture describes a **monthly** cadence, and for most of this workspace it is the whole
 * story. It is not the whole story for a company that pays some of its people twice a month:
 * Philippine law requires payment at least twice a month, and half of one entity here is on
 * `SEMI_MONTHLY` terms. A company whose `pay_frequency` is `SEMI_MONTHLY` runs **two payrolls a
 * month**, and its periods say which: `YYYY-MM-1` is the 1st to the 15th, paid on the 15th, and
 * `YYYY-MM-2` is the 16th to the month end, paid at the month end. A monthly company's periods stay
 * `YYYY-MM`. The grammar is the company's, so a half period at a monthly company and a whole month
 * at a semi-monthly company are both refused by name (`periodGrammarFault`).
 *
 * Inside a semi-monthly company, each cadence is paid on its own calendar. A `SEMI_MONTHLY`
 * employment is paid the instalment the half names, and nothing else. A `MONTHLY` employment
 * stays on the cutoff window and is paid once, in the second half, whose pay date is the month
 * end; the first half pays it nothing. `cadenceWindow` answers per cadence, `null` when the cadence
 * has nothing to pay in the period, and `resolveWindow` answers for the run: the envelope of every
 * instalment the company pays in that period, which is what the configuration is picked over and
 * what the run records as its attendance window and pay date.
 *
 * Every period pays on its last calendar day: the compliance month is the cutoff month.
 */

import { Number as EffectNumber, Schema } from 'effect';
import {
	addDays,
	dayOfMonth,
	inclusiveDays,
	monthBounds,
	monthDay,
	periodHalf,
	periodMonth,
	shiftPeriod,
	type IsoDate
} from './dates.js';
import { coversDate } from './effective.js';
import { decodeNumber } from '@norbital-ai/std/json';

export const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;

/** Whether a company's calendar can pay a cadence: monthly always, semi-monthly when it pays so. */
export const paysOn = (company: { readonly pay_frequency: string }, frequency: string): boolean =>
	usesMonthlyCalendar(frequency) ||
	(frequency === 'SEMI_MONTHLY' && company.pay_frequency === 'SEMI_MONTHLY');

/** DAILY and HOURLY specify earned units; their wages settle on the company monthly calendar. */
const usesMonthlyCalendar = (frequency: string): boolean =>
	frequency === 'MONTHLY' || frequency === 'DAILY' || frequency === 'HOURLY';
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

/**
 * The cadence an employment is paid on, as of the day the period closes.
 *
 * A mid-month change of terms is two rows, and the one in force at the end of the period is the one
 * whose cadence the run pays on — the same rule `measure.ts` applies to every other term. Terms
 * that state no frequency resolve to monthly here so the window can still be built; `measure.ts`
 * refuses them by name a step later, which is the message worth showing.
 */
export function employmentPayFrequency(
	terms: readonly { readonly pay_frequency: string | null; readonly effective_range: unknown }[],
	asOf: string
): PayFrequency {
	const row =
		terms.find((candidate) => coversDate(candidate.effective_range, asOf)) ?? terms.at(-1);
	const stated = PAY_FREQUENCIES.find((candidate) => candidate === row?.pay_frequency);
	return stated ?? 'MONTHLY';
}

const DayRangeSchema = Schema.Struct({ start: Schema.String, end: Schema.String });
type DayRange = Schema.Schema.Type<typeof DayRangeSchema>;

/** One pay event of a period: what it pays for, what it reads, and when it pays. */
const PayInstalmentSchema = Schema.Struct({
	/** 1-based position in the month. A monthly cadence has exactly one. */
	sequence: Schema.Number,
	/** The days the wages belong to; the proration denominator lives here. */
	salary: DayRangeSchema,
	/** The work days those wages cover. */
	attendance: DayRangeSchema,
	payDate: Schema.String
});
type PayInstalment = Schema.Schema.Type<typeof PayInstalmentSchema>;

const PayrollWindowSchema = Schema.Struct({
	/** The run period, in the company's grammar: `YYYY-MM`, or `YYYY-MM-1` / `YYYY-MM-2`. */
	period: Schema.String,
	/** The cadence this window was resolved for; the company's own for a run window. */
	payFrequency: Schema.Literals(PAY_FREQUENCIES),
	/** The days the wages belong to; the proration denominator lives here. */
	salary: DayRangeSchema,
	/** The work days the wages cover; time entries and leave days are selected by this. */
	attendance: DayRangeSchema,
	payDate: Schema.String,
	/**
	 * Every pay event this window settles, in order. One for a cadence window, and then `salary`,
	 * `attendance` and `payDate` above are exactly that instalment. A run window at a semi-monthly
	 * company holds every cadence's instalment in the period, and the three fields above are their
	 * envelope: the second half of a month settles the semi-monthly 16th-to-end instalment and the
	 * monthly cutoff window together.
	 */
	instalments: Schema.Array(PayInstalmentSchema)
});
export type PayrollWindow = Schema.Schema.Type<typeof PayrollWindowSchema>;

/** What the window reads off a company: the cutoff day and whether it pays twice a month. */
const PayCalendarCompanySchema = Schema.Struct({
	pay_cutoff_day: Schema.Number,
	pay_frequency: Schema.String
});
type PayCalendarCompany = Schema.Schema.Type<typeof PayCalendarCompanySchema>;

function monthParts(period: string): { year: number; monthIndex: number } {
	const month = periodMonth(period);
	return {
		year: decodeNumber(month.slice(0, 4)),
		monthIndex: decodeNumber(month.slice(5, 7)) - 1
	};
}

/** The attendance window of the monthly cadence in a period, given the company's cutoff day. */
export function attendanceWindow(period: string, cutoffDay: number): DayRange {
	const { year, monthIndex } = monthParts(period);
	return {
		start: monthDay(year, monthIndex - 1, cutoffDay),
		end: addDays(monthDay(year, monthIndex, cutoffDay), -1)
	};
}

function assertDayOfMonth(value: unknown, what: string): number {
	const day = decodeNumber(value);
	if (!Number.isInteger(day) || day < 1 || day > 31)
		throw new Error(`${what} ${String(value)} is not a day of the month.`);
	return day;
}

/** The two instalments of a semi-monthly month: the 1st to the 15th, the 16th to the month end. */
function semiMonthlyInstalments(period: string): readonly [PayInstalment, PayInstalment] {
	const { year, monthIndex } = monthParts(period);
	const bounds = monthBounds(periodMonth(period));
	const first = { start: bounds.start, end: monthDay(year, monthIndex, 15) };
	const second = { start: monthDay(year, monthIndex, 16), end: bounds.end };
	return [
		// The days an instalment reads are the days it pays for.
		{ sequence: 1, salary: first, attendance: first, payDate: first.end },
		{ sequence: 2, salary: second, attendance: second, payDate: second.end }
	];
}

/** The one monthly instalment of a period: the calendar month, read over the cutoff window. */
function monthlyInstalment(period: string, cutoffDay: number): PayInstalment {
	const bounds = monthBounds(periodMonth(period));
	return {
		sequence: 1,
		salary: bounds,
		attendance: attendanceWindow(period, cutoffDay),
		payDate: bounds.end
	};
}

/**
 * Why a period cannot be run at a company, or `null` when it can.
 *
 * The grammar is the company's: a monthly company runs months and a semi-monthly company runs
 * halves. The sentence names the company's frequency, because the fix is either the period or
 * the company's `pay_frequency`, and the operator has to know which.
 */
export function periodGrammarFault(
	period: string,
	company: { readonly pay_frequency: string; readonly name?: string }
): string | null {
	const half = periodHalf(period);
	const who = company.name ?? 'This company';
	if (company.pay_frequency === 'SEMI_MONTHLY' && half == null)
		return (
			`${who} pays SEMI_MONTHLY, so its payroll periods are halves written YYYY-MM-1 ` +
			`(the 1st to the 15th) or YYYY-MM-2 (the 16th to the month end); "${period}" names a whole month.`
		);
	if (company.pay_frequency !== 'SEMI_MONTHLY' && half != null)
		return (
			`${who} pays ${company.pay_frequency}, so its payroll periods are months written ` +
			`YYYY-MM; "${period}" names half of one.`
		);
	return null;
}

function envelope(
	period: string,
	payFrequency: PayFrequency,
	instalments: readonly PayInstalment[]
): PayrollWindow {
	const span = (ranges: readonly DayRange[]): DayRange => ({
		start: ranges.reduce(
			(earliest, one) => (one.start < earliest ? one.start : earliest),
			ranges[0]!.start
		),
		end: ranges.reduce((latest, one) => (one.end > latest ? one.end : latest), ranges[0]!.end)
	});
	return {
		period,
		payFrequency,
		salary: span(instalments.map((one) => one.salary)),
		attendance: span(instalments.map((one) => one.attendance)),
		payDate: instalments.reduce(
			(latest, one) => (one.payDate > latest ? one.payDate : latest),
			instalments[0]!.payDate
		),
		instalments
	};
}

/**
 * The window one cadence of one company is paid on in a period, or `null` when that cadence has
 * nothing to pay in it.
 *
 * `MONTHLY` (and the DAILY and HOURLY units that settle on the monthly calendar) is the calendar
 * the company's own `pay_cutoff_day` describes. At a semi-monthly company it exists only in the
 * second half: the cutoff window for the month, paid at the month end. `SEMI_MONTHLY` is the one
 * instalment the half names, and needs the company to pay twice a month; asking for it from a
 * monthly company throws, because paying someone on a calendar the company never stated is the
 * failure this whole type exists to stop. The run refuses that case earlier and by name — see
 * `validatePayCalendar`.
 */
export function cadenceWindow(
	period: string,
	company: PayCalendarCompany,
	payFrequency: PayFrequency
): PayrollWindow | null {
	const cutoffDay = assertDayOfMonth(company.pay_cutoff_day, 'Company pay cutoff day');
	const fault = periodGrammarFault(period, company);
	if (fault != null) throw new Error(fault);
	const half = periodHalf(period);
	if (usesMonthlyCalendar(payFrequency)) {
		if (half === 1) return null;
		return envelope(period, payFrequency, [monthlyInstalment(period, cutoffDay)]);
	}
	if (!paysOn(company, payFrequency))
		throw new Error(
			`This company pays ${company.pay_frequency}, so there is no ${payFrequency} window it could ` +
				'pay someone on those terms over.'
		);
	const [first, second] = semiMonthlyInstalments(period);
	return envelope(period, payFrequency, [half === 1 ? first : second]);
}

/**
 * The window a run is built on: every instalment the company pays in the period, and the envelope
 * of them.
 *
 * A monthly company's run is its one monthly instalment. A semi-monthly company's first half is
 * the 1st-to-15th instalment alone; its second half settles the 16th-to-end instalment and the
 * monthly cutoff window together, so its attendance runs from the cutoff to the month end and it
 * pays at the month end. The grammar is checked here too, so a period the company cannot run
 * never yields a window.
 */
export function resolveWindow(period: string, company: PayCalendarCompany): PayrollWindow {
	const fault = periodGrammarFault(period, company);
	if (fault != null) throw new Error(fault);
	const cadences: PayFrequency[] =
		company.pay_frequency === 'SEMI_MONTHLY' ? ['SEMI_MONTHLY', 'MONTHLY'] : ['MONTHLY'];
	const instalments = cadences.flatMap(
		(cadence) => cadenceWindow(period, company, cadence)?.instalments ?? []
	);
	const payFrequency = company.pay_frequency === 'SEMI_MONTHLY' ? 'SEMI_MONTHLY' : 'MONTHLY';
	return envelope(period, payFrequency, instalments);
}

/** The cadence a default pay period is resolved for: the company, and the employment's frequency. */
export type PayCadence = {
	readonly company: { readonly pay_frequency: string };
	readonly payFrequency: string;
};

/**
 * Which run a component entry belongs to when its `pay_period` was left blank.
 *
 * This is the money cutoff, not the attendance cutoff: an entry dated on or before the cutoff
 * pays this month, one dated after it pays next month. `component_entries.pay_period` overrides it and is
 * authoritative wherever it is set, because a late-submitted December claim is still December's
 * money (decision L16).
 *
 * At a semi-monthly company the answer is in that company's grammar. A semi-monthly employment's
 * entry settles in the half its day falls in, the 15th included in the first; a monthly
 * employment there is paid once, in the second half, so its entry settles in the `-2` run of the
 * month the cutoff rule names. Without a cadence the answer is the monthly one.
 */
export function defaultPayPeriod(
	eventDate: IsoDate,
	cutoffDay: number,
	cadence?: PayCadence
): string {
	const month = eventDate.slice(0, 7);
	if (cadence?.company.pay_frequency === 'SEMI_MONTHLY') {
		if (cadence.payFrequency === 'SEMI_MONTHLY')
			return dayOfMonth(eventDate) <= 15 ? `${month}-1` : `${month}-2`;
		return `${dayOfMonth(eventDate) <= cutoffDay ? month : shiftPeriod(month, 1)}-2`;
	}
	return dayOfMonth(eventDate) <= cutoffDay ? month : shiftPeriod(month, 1);
}

/** Calendar months left in the tax year, this one included. */
function monthsRemaining(period: string, taxYearStartMonth: number): number {
	const month = decodeNumber(periodMonth(period).slice(5, 7));
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	const elapsed = (month - start + 12) % 12;
	return 12 - elapsed;
}

/**
 * Payslips left in the tax year to one cadence, this one included. Feeds the PCB spread.
 *
 * **The unit is the payslip, and it has to be.** CONTRIBUTE spreads the tax still to withhold
 * over this number, and the number it divides is *this payslip's* share, so the count must be of
 * payslips and nothing else. A monthly cadence receives one payslip a month. A semi-monthly
 * employment receives one per run, so twenty-four remain to it in the first half of January and
 * twenty-three in the second: the count is per cadence, never per company, because a monthly
 * employment at a semi-monthly company is still paid twelve times.
 */
export function payPeriodsRemaining(
	period: string,
	taxYearStartMonth: number,
	payFrequency: PayFrequency = 'MONTHLY'
): number {
	const months = monthsRemaining(period, taxYearStartMonth);
	if (payFrequency !== 'SEMI_MONTHLY') return months;
	return months * 2 - (periodHalf(period) === 2 ? 1 : 0);
}

/** How the withholding projection sees one payslip. */
const PayProjectionSchema = Schema.Struct({
	/** Payslips left in the tax year to this cadence, this one included; the tax is spread over it. */
	payslipsRemaining: Schema.Number,
	/**
	 * How many payslips the size of this one the rest of the tax year holds after it. Twelve minus
	 * the months elapsed, less one, for a monthly payslip. A half-month payslip is smaller than a
	 * month, so the year after it holds more of them than there are runs: the remaining months plus
	 * the unpaid rest of this month, divided by this payslip's share of a month.
	 */
	futurePayslipEquivalents: Schema.Number
});
export type PayProjection = Schema.Schema.Type<typeof PayProjectionSchema>;

/**
 * The projection horizon of one payslip, so that a year of twenty-four half-month payslips lands
 * exactly where a year of twelve monthly ones did.
 *
 * CONTRIBUTE projects `year-to-date + this payslip's base × (1 + future equivalents)`. For a
 * monthly payslip in January that is the base twelve times over. For the first half of January
 * the base is 15/31 of a month and the year after it holds the other 16/31 plus eleven whole
 * months: `(11 + 16/31) / (15/31)` payslips of this size, and the projection is again twelve
 * months' wages. The second half carries the first in its year-to-date, so only the eleven whole
 * months remain: `11 / (16/31)`. The share is measured in calendar days; a jurisdiction that
 * prorates by working days sees an estimate here, which the year-to-date and the amount already
 * withheld correct on every later payslip.
 */
export function payProjection(
	period: string,
	taxYearStartMonth: number,
	window: PayrollWindow
): PayProjection {
	const months = monthsRemaining(period, taxYearStartMonth);
	const payslipsRemaining = payPeriodsRemaining(period, taxYearStartMonth, window.payFrequency);
	const half = periodHalf(period);
	if (half == null || window.payFrequency !== 'SEMI_MONTHLY')
		return { payslipsRemaining, futurePayslipEquivalents: months - 1 };
	const bounds = monthBounds(periodMonth(period));
	const monthDays = inclusiveDays(bounds.start, bounds.end);
	const share = inclusiveDays(window.salary.start, window.salary.end) / monthDays;
	const unpaidRestOfMonth = half === 1 ? 1 - share : 0;
	return {
		payslipsRemaining,
		futurePayslipEquivalents: (months - 1 + unpaidRestOfMonth) / share
	};
}

/** The tax year label a period falls in, for year-to-date accumulation. */
export function taxYearOf(period: string, taxYearStartMonth: number): string {
	const month = periodMonth(period);
	const year = decodeNumber(month.slice(0, 4));
	const monthNumber = decodeNumber(month.slice(5, 7));
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	return String(monthNumber >= start ? year : year - 1);
}

/** The first month of the tax year `period` falls in, as `YYYY-MM`. */
export function taxYearFirstPeriod(period: string, taxYearStartMonth: number): string {
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	return `${taxYearOf(period, taxYearStartMonth)}-${String(start).padStart(2, '0')}`;
}

/**
 * One company has one run per period, and periods are created in order.
 *
 * A standing draft no longer blocks the next period. It used to: an unsettled January refused a
 * February run outright, so a month waiting on one person's correction froze the next month's
 * payroll for everybody. Runs may now stand in order, unpaid — what stays ordered is *payment*
 * (`+hooks.ts` refuses marking a run paid while an earlier one is still a draft) and *deletion*
 * (only the latest run may be deleted, so a lineage is unwound from the end rather than punched
 * a hole through).
 *
 * A period the company skipped is still refused, because the skip is the fault: creating March
 * while February was never run leaves February's wages, attendance and entries unconsumed with
 * nothing that will ever pick them up.
 */
export function assertPayrollPeriodAvailable(
	runs: readonly { readonly period: string; readonly lifecycle: string }[],
	period: string
): void {
	if (runs.some((run) => run.period === period))
		refuse(
			`Payroll ${period} already exists. Delete its draft to replace it, or settle later approved entries in the next payroll period.`
		);
	const later = runs.find((run) => run.period > period);
	if (later)
		refuse(
			`Payroll ${later.period} already exists. Record corrections in the next payroll period.`
		);
}

/**
 * Drafts are unwound from the end.
 *
 * Deleting a run releases every source it captured. Doing that to a run with a later run standing
 * on top of it would release rows the later run has already read and priced, so the later run's
 * payslips would cite inputs that are free again — and nothing downstream would notice. The order
 * was documented and unchecked; this is the check.
 */
export function assertPayrollRunDeletable(
	runs: readonly { readonly period: string }[],
	period: string
): void {
	const later = runs.find((run) => run.period > period);
	if (later)
		refuse(
			`Payroll ${later.period} was run after ${period}. Delete payrolls newest first, or ${later.period} would cite inputs this delete releases.`
		);
}
