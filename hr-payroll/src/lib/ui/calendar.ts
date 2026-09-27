/**
 * Calendar helpers used by the app pages for *display* only.
 *
 * Nothing here decides payroll: the period window, cutoff handling and pay-date shifting that a
 * run is actually built with belong to the payroll engine and reach the UI as stored
 * `payroll_runs.pay_date` / `attendance_from` / `attendance_to` columns. These functions only put
 * a period's pay date (its last day) on a calendar so an operator can see which cycles are still
 * open.
 */

import { PlainDate, days, monthOf } from '@norbital-ai/std/date';
import { isCalendarDate } from '../iso-day.js';
import { periodHalf, periodMonth, shiftPeriod } from '../../lib/payroll/run/dates.js';
import { weeklyInstalments } from '../../lib/payroll/run/period.js';

import { PAYROLL_TIME_ZONE, calendarDateInTimeZone } from '../iso-day.js';
import { offsetMinutesAt } from '../timezone.js';

/**
 * Calendar day of "now" in the payroll timezone — the reference every board on these pages is drawn
 * against, and the operand every `effective_range: { contains_date: … }` filter is prefilled with.
 *
 * `now` is injectable so a caller with its own clock (an effect reading one, or a test) can hand the
 * instant over; the default stays the parameter-default exemption — the calendar is a display helper
 * and `new Date()` here is the ordinary reading of "now".
 *
 * This used to be `new Date().toISOString().slice(0, 10)`, which is the *UTC* day.
 * `dates-and-time.md` names that expression as forbidden for exactly this use: for eight hours of
 * every day it selects yesterday's rate row, so a transform could price against a different day
 * than the client had displayed.
 */
export function todayKey(now: Date = new Date()): PlainDate {
	return PlainDate(calendarDateInTimeZone(now, PAYROLL_TIME_ZONE));
}

/**
 * The instant at which `calendarDate` begins in `timeZone`.
 *
 * This is wall-clock arithmetic — the roster's minute offsets and the viewer-zone picker adapters
 * below anchor on it. It is not how a day is *stored*: a day-precision column and a day-precision
 * range bound hold the canonical UTC day (`dayInstant`), whatever zone the business runs in.
 *
 * The offset is resolved twice because the zone's offset at UTC midnight and at the corrected
 * instant can differ across a daylight-saving transition; the second pass settles on the offset
 * actually in force at the answer.
 */
export function startOfDayInstant(calendarDate: string, timeZone: string): string {
	if (!isCalendarDate(calendarDate)) {
		throw new Error(`"${calendarDate}" is not a YYYY-MM-DD calendar date.`);
	}
	const utcMidnight = new Date(`${calendarDate}T00:00:00.000Z`);
	const offsetMs = (at: Date) => offsetMinutesAt(timeZone, at) * 60_000;
	const firstPass = new Date(utcMidnight.getTime() - offsetMs(utcMidnight));
	return new Date(utcMidnight.getTime() - offsetMs(firstPass)).toISOString();
}

/** Number of days in the `YYYY-MM` month. */
export function daysInMonth(period: string): number {
	return days(monthOf(`${period}-01`));
}

/** The first and last day of the month a period pays for: `1–15`, `16–28`, or the whole month. */
export function periodDayRange(period: string): { readonly from: number; readonly to: number } {
	const last = daysInMonth(periodMonth(period));
	switch (periodHalf(period)) {
		case 1:
			return { from: 1, to: 15 };
		case 2:
			return { from: 16, to: last };
		default:
			return { from: 1, to: last };
	}
}

/**
 * A selected period restated in the company's grammar: a semi-monthly company reads a bare month
 * as the half `today` falls in, a monthly company drops a half suffix. The board and its picker
 * follow the entity's pay cycle, not the calendar month.
 */
export function periodInCompanyGrammar(
	period: string,
	payFrequency: string | undefined,
	today: string
): string {
	const month = periodMonth(period);
	if (payFrequency === 'WEEKLY') {
		const weeks = weeklyInstalments(month);
		const named = periodHalf(period);
		if (named != null && named <= weeks.length) return period;
		// The week today falls in, where today is in the month; else the month's first week.
		const current = weeks.findIndex(
			(week) => week.salary.start <= today && today <= week.salary.end
		);
		return `${month}-${current >= 0 ? current + 1 : 1}`;
	}
	if (payFrequency !== 'SEMI_MONTHLY') return month;
	if (periodHalf(period) != null && (periodHalf(period) ?? 0) <= 2) return period;
	return `${month}-${Number.parseInt(today.slice(8, 10), 10) <= 15 ? 1 : 2}`;
}

/**
 * The periods a company runs over a list of months: the months themselves, or both halves of each
 * for a semi-monthly company, in chronological order.
 */
export function companyPeriods(months: readonly string[], payFrequency: string): string[] {
	if (payFrequency === 'WEEKLY')
		return months.flatMap((month) =>
			weeklyInstalments(month).map((week) => `${month}-${week.sequence}`)
		);
	if (payFrequency !== 'SEMI_MONTHLY') return [...months];
	return months.flatMap((month) => [`${month}-1`, `${month}-2`]);
}

/**
 * The day a period pays: the 15th for a first half, a week's Sunday, otherwise its last calendar
 * day. The compliance month is the cutoff month.
 */
export function payDateFor(period: string, payFrequency?: string): string {
	const month = periodMonth(period);
	if (payFrequency === 'WEEKLY') {
		const week = weeklyInstalments(month)[(periodHalf(period) ?? 1) - 1];
		if (week != null) return week.payDate;
	}
	return `${month}-${String(periodDayRange(period).to).padStart(2, '0')}`;
}

/** The days a weekly period pays for, `null` where the period is not a week of a weekly company. */
export function weekOf(
	period: string,
	payFrequency: string | undefined
): { readonly start: string; readonly end: string } | null {
	if (payFrequency !== 'WEEKLY') return null;
	return weeklyInstalments(periodMonth(period))[(periodHalf(period) ?? 1) - 1]?.salary ?? null;
}

/** The `YYYY-MM` periods spanning `count` months, ending `ahead` months after the current month. */
export function periodWindow(count: number, ahead: number): string[] {
	const current = todayKey().slice(0, 7);
	return Array.from({ length: count }, (_value, index) =>
		shiftPeriod(current, ahead - count + 1 + index)
	);
}
