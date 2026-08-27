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
 * ## Cadence
 *
 * That picture describes a **monthly** cadence, and for most of this workspace it is the whole
 * story. It is not the whole story for a company that pays some of its people twice a month:
 * Philippine law requires payment at least twice a month, and half of one entity here is on
 * `SEMI_MONTHLY` terms. Such a cadence has more than one pay event inside the period — its own
 * salary window, its own attendance window and its own pay date each — and those are read from
 * `companies.pay_calendar`, which states them (see `custom-types/pay_calendar`). A window is
 * therefore resolved *for a cadence*: `resolveWindow(period, company, 'SEMI_MONTHLY')` answers with
 * both instalments, and `resolveWindow(period, company)` answers with the single monthly one.
 *
 * The instalments of a period tile it exactly — the first opens on the 1st, each next opens the day
 * after the previous closes, the last closes on the last day of the month — so no day of a month is
 * paid twice and none is missed. That is checked here on every read, not assumed.
 */

import { Number as EffectNumber, Schema } from 'effect';
import { addDays, dayOfMonth, monthBounds, monthDay, shiftPeriod, type IsoDate } from './dates.js';

export const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

const DayRangeSchema = Schema.Struct({ start: Schema.String, end: Schema.String });
type DayRange = Schema.Schema.Type<typeof DayRangeSchema>;

/** One pay event of a period: what it pays for, what it reads, and when it pays. */
const PayInstalmentSchema = Schema.Struct({
	/** 1-based position in the period. A monthly cadence has exactly one. */
	sequence: Schema.Number,
	/** The days the wages belong to; the proration denominator lives here. */
	salary: DayRangeSchema,
	/** The work days those wages cover. */
	attendance: DayRangeSchema,
	payDate: Schema.String
});
type PayInstalment = Schema.Schema.Type<typeof PayInstalmentSchema>;

const PayrollWindowSchema = Schema.Struct({
	/** `YYYY-MM`. */
	period: Schema.String,
	/** The cadence this window was resolved for. */
	payFrequency: Schema.Literals(PAY_FREQUENCIES),
	/** The calendar month the wages belong to; the proration denominator lives here. */
	salary: DayRangeSchema,
	/** The work days the wages cover; time entries and leave days are selected by this. */
	attendance: DayRangeSchema,
	payDate: Schema.String,
	/**
	 * Every pay event of the period, in order. One for a monthly cadence, and then `salary`,
	 * `attendance` and `payDate` above are exactly that one instalment; two for a semi-monthly
	 * cadence, and then they are the envelope — the whole month, and the last pay date of it,
	 * because a run settles every instalment of its period together.
	 */
	instalments: Schema.Array(PayInstalmentSchema)
});
export type PayrollWindow = Schema.Schema.Type<typeof PayrollWindowSchema>;

/** What `companies` states about its calendars, as it is stored. */
const StoredPayCalendarSchema = Schema.NullOr(
	Schema.Array(
		Schema.Struct({
			pay_frequency: Schema.String,
			instalments: Schema.Array(
				Schema.Struct({
					start_day: Schema.Number,
					end_day: Schema.Number,
					pay_day: Schema.Number
				})
			)
		})
	)
);
export type StoredPayCalendar = Schema.Schema.Type<typeof StoredPayCalendarSchema>;

const PayCalendarCompanySchema = Schema.Struct({
	pay_cutoff_day: Schema.Number,
	pay_day: Schema.Number,
	pay_calendar: Schema.optionalKey(StoredPayCalendarSchema)
});
type PayCalendarCompany = Schema.Schema.Type<typeof PayCalendarCompanySchema>;

function periodParts(period: string): { year: number; monthIndex: number } {
	if (!/^\d{4}-\d{2}$/.test(period))
		throw new Error(`Payroll period must be YYYY-MM, received "${period}".`);
	return { year: Number(period.slice(0, 4)), monthIndex: Number(period.slice(5, 7)) - 1 };
}

/** The attendance window of a monthly period, given the company's cutoff day. */
export function attendanceWindow(period: string, cutoffDay: number): DayRange {
	const { year, monthIndex } = periodParts(period);
	return {
		start: monthDay(year, monthIndex - 1, cutoffDay),
		end: addDays(monthDay(year, monthIndex, cutoffDay), -1)
	};
}

function assertDayOfMonth(value: unknown, what: string): number {
	const day = Number(value);
	if (!Number.isInteger(day) || day < 1 || day > 31)
		throw new Error(`${what} ${String(value)} is not a day of the month.`);
	return day;
}

/**
 * The instalments a cadence divides one period into, or `null` when the company states none.
 *
 * A stated calendar that does not tile the month is refused rather than paid: an instalment that
 * starts a day late leaves a day nobody is paid for, and one that starts a day early pays a day
 * twice. Both are silent in money and loud only at the end of a year, which is why the check is
 * here — on the read every run makes — as well as in `companies/+hooks.ts` on the write.
 */
export function payCalendarInstalments(
	period: string,
	company: PayCalendarCompany,
	payFrequency: PayFrequency
): PayInstalment[] | null {
	const calendars = company.pay_calendar ?? [];
	const stated = calendars.find((entry) => entry.pay_frequency === payFrequency);
	if (stated == null) return null;
	const { year, monthIndex } = periodParts(period);
	const bounds = monthBounds(period);
	const instalments = stated.instalments.map((instalment, index) => {
		const what = `Pay calendar ${payFrequency}`;
		const startDay = assertDayOfMonth(instalment.start_day, `${what} start day`);
		const endDay = assertDayOfMonth(instalment.end_day, `${what} end day`);
		const payDay = assertDayOfMonth(instalment.pay_day, `${what} pay day`);
		const salary = {
			start: monthDay(year, monthIndex, startDay),
			end: monthDay(year, monthIndex, endDay)
		};
		if (salary.end < salary.start)
			throw new Error(
				`Pay calendar ${payFrequency} instalment ${index + 1} closes on ${salary.end}, before it ` +
					`opens on ${salary.start}.`
			);
		return {
			sequence: index + 1,
			salary,
			// The days it reads are the days it pays for. A cadence that reads a narrower slice for
			// overtime says so in `settlement_policy.overtime_windows`; unpaid leave keeps following
			// the company's ordinary cutoff, which is the run's own window and not this one.
			attendance: salary,
			payDate: monthDay(year, monthIndex, payDay)
		} satisfies PayInstalment;
	});
	if (instalments.length === 0)
		throw new Error(`Pay calendar ${payFrequency} states no instalments, so it pays nothing.`);
	if (instalments[0]!.salary.start !== bounds.start)
		throw new Error(
			`Pay calendar ${payFrequency} opens on ${instalments[0]!.salary.start}, so ` +
				`${bounds.start} is paid by no instalment of ${period}.`
		);
	if (instalments.at(-1)!.salary.end !== bounds.end)
		throw new Error(
			`Pay calendar ${payFrequency} closes on ${instalments.at(-1)!.salary.end}, so the days up ` +
				`to ${bounds.end} are paid by no instalment of ${period}.`
		);
	for (let index = 1; index < instalments.length; index += 1) {
		const previous = instalments[index - 1]!;
		const current = instalments[index]!;
		if (current.salary.start !== addDays(previous.salary.end, 1))
			throw new Error(
				`Pay calendar ${payFrequency} instalment ${index + 1} opens on ${current.salary.start} ` +
					`while instalment ${index} closes on ${previous.salary.end}: a day of ${period} is ` +
					'either paid twice or paid by nobody.'
			);
	}
	return instalments;
}

/**
 * The window one cadence of one company is run on.
 *
 * `payFrequency` defaults to `MONTHLY`, which is the calendar the company's own `pay_cutoff_day`
 * and `pay_day` describe and the only calendar most companies have. Any other cadence must be
 * stated in `companies.pay_calendar`; asking for one that is not stated throws, because paying
 * someone on a calendar that was never written down is the failure this whole type exists to stop.
 * The run refuses that case earlier and by name — see `validatePayCalendar`.
 */
export function resolveWindow(
	period: string,
	company: PayCalendarCompany,
	payFrequency: PayFrequency = 'MONTHLY'
): PayrollWindow {
	const { year, monthIndex } = periodParts(period);
	const cutoffDay = assertDayOfMonth(company.pay_cutoff_day, 'Company pay cutoff day');
	const payDay = assertDayOfMonth(company.pay_day, 'Company pay day');
	const monthly: PayInstalment = {
		sequence: 1,
		salary: monthBounds(period),
		attendance: attendanceWindow(period, cutoffDay),
		payDate: monthDay(year, monthIndex, payDay)
	};
	const instalments =
		payFrequency === 'MONTHLY' ? [monthly] : payCalendarInstalments(period, company, payFrequency);
	if (instalments == null)
		throw new Error(
			`This company states no ${payFrequency} pay calendar, so there is no window it could pay ` +
				'someone on those terms over.'
		);
	const first = instalments[0]!;
	const last = instalments.at(-1)!;
	return {
		period,
		payFrequency,
		salary: { start: first.salary.start, end: last.salary.end },
		attendance: { start: first.attendance.start, end: last.attendance.end },
		payDate: last.payDate,
		instalments
	};
}

/**
 * Which run an obligation belongs to when its `pay_period` was left blank.
 *
 * This is the money cutoff, not the attendance cutoff: an obligation dated on or before the cutoff
 * pays this month, one dated after it pays next month. `obligations.pay_period` overrides it and is
 * authoritative wherever it is set, because a late-submitted December claim is still December's
 * money (decision L16).
 */
export function defaultPayPeriod(eventDate: IsoDate, cutoffDay: number): string {
	const period = eventDate.slice(0, 7);
	return dayOfMonth(eventDate) <= cutoffDay ? period : shiftPeriod(period, 1);
}

/**
 * Pay periods left in the tax year, this one included. Feeds the PCB projection.
 *
 * **The unit is the payslip, and it has to be.** CONTRIBUTE projects an annual figure as
 * `year-to-date + this payslip's base × periods remaining`, and spreads the tax back over the same
 * number; the relief projection in the same function divides a cap by `remaining − 1`. Every one of
 * those multiplies or divides *this payslip's* money, so the count must be of payslips and nothing
 * else.
 *
 * A semi-monthly employment is paid twice a month, so 24 pay events remain to it in a January tax
 * year — and that number must **not** be handed to the projection. A run settles every instalment
 * of its period in one payslip carrying the whole month's wages (`base_salary` is the monthly
 * contract wage for monthly and semi-monthly terms alike — see `ordinary-rate.ts`), so twelve
 * payslips remain to a semi-monthly employment exactly as they do to a monthly one. Passing 24
 * would project double the annual income and then withhold half of the tax it computed in each
 * payslip. The pay events themselves are `payPeriodsRemaining(…) × window.instalments.length`, and
 * that is the figure to reach for when the question really is "how many more times are they paid".
 */
export function payPeriodsRemaining(period: string, taxYearStartMonth: number): number {
	const month = Number(period.slice(5, 7));
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	const elapsed = (month - start + 12) % 12;
	return 12 - elapsed;
}

/** The tax year label a period falls in, for year-to-date accumulation. */
export function taxYearOf(period: string, taxYearStartMonth: number): string {
	const year = Number(period.slice(0, 4));
	const month = Number(period.slice(5, 7));
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	return String(month >= start ? year : year - 1);
}

/** The first period of the tax year `period` falls in. */
export function taxYearFirstPeriod(period: string, taxYearStartMonth: number): string {
	const start = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(taxYearStartMonth));
	return `${taxYearOf(period, taxYearStartMonth)}-${String(start).padStart(2, '0')}`;
}
