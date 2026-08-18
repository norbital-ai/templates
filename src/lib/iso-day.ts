import { Schema } from 'effect';

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
 * A timestamp carrying a UTC offset, as `2026-04-02T10:30:00+08:00` — the spelling attendance
 * sources publish, unlike the UTC instants a date-range bound is stored as.
 *
 * The pattern fixes the grammar; the filter rejects `2026-02-30T00:00:00Z`, which the pattern
 * alone admits and `Date` silently rolls into March.
 */
export const offsetDateTime = Schema.String.check(
	Schema.isPattern(
		/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/
	),
	Schema.makeFilter(
		(value: string) =>
			(!Number.isNaN(new Date(value).getTime()) &&
				new Date(value).toISOString().slice(0, 10) === value.slice(0, 10)) ||
			'must name a day that exists',
		{ title: 'realCalendarDay' }
	)
);
