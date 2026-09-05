import { Schema } from 'effect';
import { isCalendarDate } from '@norbital-ai/std/date';

/** The workspace business zone owns payroll calendar dates, independently of the host. */
export const PAYROLL_TIME_ZONE = 'Asia/Kuala_Lumpur';
const payrollDateFormat = new Intl.DateTimeFormat('en', {
	timeZone: PAYROLL_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export function calendarDateInTimeZone(value: Date, timeZone: string): string {
	const formatter =
		timeZone === PAYROLL_TIME_ZONE
			? payrollDateFormat
			: new Intl.DateTimeFormat('en', {
					timeZone,
					year: 'numeric',
					month: '2-digit',
					day: '2-digit'
				});
	const parts = formatter.formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Resolve stored instants in the business zone; fixed calendar-day strings retain their day. */
export function dateKey(value: string | null | undefined): string {
	if (value == null || value === '') return '';
	if (isCalendarDate(value)) return value;
	if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return '';
	const instant = new Date(value);
	if (!Number.isFinite(instant.getTime())) return '';
	const day = calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE);
	// Existing far-future open-range fixtures must keep a four-digit sortable endpoint.
	return day.length === 10 ? day : value.slice(0, 10);
}

/**
 * A calendar day in the payroll timezone, as `2026-04-02`.
 *
 * The pattern fixes the grammar and the filter fixes the calendar, for the same reason the
 * platform's instant schema pairs them: the pattern alone admits `2026-02-30`, which `Date` rolls
 * forward to March, so a day that does not exist would be recorded as if it did.
 */
export const calendarDay = Schema.String.check(
	Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
	Schema.makeFilter(
		(value: string) =>
			new Date(`${value}T00:00:00Z`).toISOString().startsWith(value) ||
			'must name a day that exists',
		{ title: 'realCalendarDay' }
	)
);

/**
 * The `Date` a timestamp column stores, from a `Clock.currentTimeMillis` stamp.
 *
 * One named conversion rather than a `new Date(...)` at each write: a bare construction reads as
 * the ambient clock wherever it appears, and the whole point of taking the stamp from `Clock` is
 * that it is not ambient. The millisecond value is the caller's to obtain.
 */
export function instantAt(milliseconds: number): Date {
	return new Date(milliseconds);
}
