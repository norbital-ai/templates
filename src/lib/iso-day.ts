import { Schema } from 'effect';

/**
 * The `YYYY-MM-DD` head of a stored instant, or `''` when the value is null/undefined.
 *
 * The single place every writer keys a day by: `lock.ts`, `leave-coverage.ts`, the leave-request
 * hooks and the employment hooks all used to carry their own copy that is exactly this body, and
 * a key they disagreed on would make two writers give one date two names.
 */
export function dateKey(value: string | null | undefined): string {
	if (value == null) return '';
	return value.slice(0, 10);
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
