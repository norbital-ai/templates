const FIELD_TIME_ZONE = 'Asia/Singapore';

/** The desk's calendar day for a given instant, in one fixed zone. */
export function calendarDateInTimeZone(value: Date): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: FIELD_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(value);
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}
