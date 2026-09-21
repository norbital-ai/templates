const FIELD_TIME_ZONE = 'Asia/Singapore';

/** The desk's calendar day for a given instant, in Singapore unless a viewer zone is supplied. */
export function calendarDateInTimeZone(value: Date, timeZone = FIELD_TIME_ZONE): string {
	const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(value);
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year').padStart(4, '0')}-${valueFor('month')}-${valueFor('day')}`;
}

/**
 * The stored UTC calendar day a day-precision picker emitted, or null when it names none.
 *
 * A `precision: 'day'` field holds one canonical UTC day and every reader resolves it by its date
 * prefix, so a picker value is read back the same way rather than through a viewer-zone conversion
 * the platform renderer has already applied.
 */
export function calendarDayOfInstant(value: unknown): string | null {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
