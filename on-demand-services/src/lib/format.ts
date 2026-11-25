import { DateTime } from 'effect';

/** Milliseconds since the Unix epoch for an ISO instant or calendar date. */
export const epochMs = (value: string): number =>
	DateTime.toEpochMillis(DateTime.makeUnsafe(value));

/** Format an ISO instant in a named IANA timezone using Effect `DateTime` epoch millis (no JS `Date`). */
export const formatInstant = (
	value: string,
	zone: string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
	locale = 'en'
): string => new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }).format(epochMs(value));

/** Format an ISO calendar date (`YYYY-MM-DD`) at UTC midnight so no timezone shifts its calendar day. */
export const formatCalendarDate = (
	day: string,
	options: Intl.DateTimeFormatOptions,
	locale = 'en'
): string => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(epochMs(day));
