const FIELD_TIME_ZONE = 'Asia/Singapore';

interface ZonedDateTimeParts {
	readonly year: string;
	readonly month: string;
	readonly day: string;
	readonly hour: string;
	readonly minute: string;
	readonly second: string;
	readonly millisecond: string;
}

function zonedDateTimeParts(value: Date, timeZone: string): ZonedDateTimeParts {
	const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3
	}).formatToParts(value);
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return {
		year: valueFor('year').padStart(4, '0'),
		month: valueFor('month'),
		day: valueFor('day'),
		hour: valueFor('hour'),
		minute: valueFor('minute'),
		second: valueFor('second'),
		millisecond: valueFor('fractionalSecond')
	};
}

/** The desk's calendar day for a given instant, in Singapore unless a viewer zone is supplied. */
export function calendarDateInTimeZone(value: Date, timeZone = FIELD_TIME_ZONE): string {
	const parts = zonedDateTimeParts(value, timeZone);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseCalendarDay(value: string): Date {
	if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`"${value}" is not a YYYY-MM-DD calendar day.`);
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
		throw new Error(`"${value}" is not a valid calendar day.`);
	}
	return parsed;
}

/** How far `timeZone` is ahead of UTC at `value`, including historical sub-minute offsets. */
function timeZoneOffsetMs(value: Date, timeZone: string): number {
	const parts = zonedDateTimeParts(value, timeZone);
	const wallClockAsUtc = new Date(
		`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}Z`
	);
	return wallClockAsUtc.getTime() - value.getTime();
}

/** First representable instant on `value`, for zones whose DST jump removes local midnight. */
function firstInstantOfCalendarDay(value: string, pickerTimeZone: string, utcMidnight: Date): Date {
	const searchRadiusMs = 36 * 60 * 60 * 1000;
	let before = utcMidnight.getTime() - searchRadiusMs;
	let after = utcMidnight.getTime() + searchRadiusMs;
	while (after - before > 1) {
		const candidate = before + Math.floor((after - before) / 2);
		if (calendarDateInTimeZone(new Date(candidate), pickerTimeZone) < value) {
			before = candidate;
		} else {
			after = candidate;
		}
	}

	const first = new Date(after);
	if (calendarDateInTimeZone(first, pickerTimeZone) !== value) {
		throw new Error(`"${value}" does not occur in ${pickerTimeZone}.`);
	}
	return first;
}

/**
 * Represent a calendar-day key as the viewer-local instant expected by the canonical day picker.
 *
 * ISO parsing is deliberate: `new Date(year, month, day)` silently maps years 0–99 into 1900–1999
 * and rolls invalid dates into a later month. Resolving the zone twice also accounts for a DST
 * offset that differs between the UTC guess and the resulting local midnight. In the few zones
 * where a DST jump erases midnight itself, the earliest representable instant on that same day is
 * used; a civil day skipped entirely by an offset change remains invalid.
 */
export function calendarDayAsPickerInstant(value: string, pickerTimeZone: string): string {
	const utcMidnight = parseCalendarDay(value);
	let candidate = utcMidnight;
	for (let pass = 0; pass < 3; pass += 1) {
		const next = new Date(utcMidnight.getTime() - timeZoneOffsetMs(candidate, pickerTimeZone));
		if (next.getTime() === candidate.getTime()) break;
		candidate = next;
	}

	const local = zonedDateTimeParts(candidate, pickerTimeZone);
	if (
		`${local.year}-${local.month}-${local.day}` === value &&
		`${local.hour}:${local.minute}:${local.second}.${local.millisecond}` === '00:00:00.000'
	) {
		return candidate.toISOString();
	}
	return firstInstantOfCalendarDay(value, pickerTimeZone, utcMidnight).toISOString();
}

/** Recover the calendar-day key selected by a day picker, or reject a malformed picker payload. */
export function calendarDayFromPickerInstant(
	value: unknown,
	pickerTimeZone: string
): string | null {
	if (typeof value !== 'string') return null;
	const instant = new Date(value);
	if (Number.isNaN(instant.getTime())) return null;
	return calendarDateInTimeZone(instant, pickerTimeZone);
}
