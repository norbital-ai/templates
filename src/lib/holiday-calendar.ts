import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import type { WorkspaceRow } from '../collections/jurisdiction_holiday_calendars/$types.js';
import type { HolidayObservation } from '../datatypes/holiday_observations/+definition.js';
import type { HolidayCalendarSnapshot } from '../datatypes/holiday_calendar_snapshots/+definition.js';

export type HolidayCalendar = Pick<
	WorkspaceRow<'jurisdiction_holiday_calendars'>,
	'id' | 'jurisdiction_code' | 'year' | 'revision' | 'observations' | 'published_at'
>;

export function validateHolidayCalendar(
	calendar: Omit<HolidayCalendar, 'id' | 'published_at'>
): void {
	if (!calendar.jurisdiction_code.trim()) refuse('A holiday calendar needs a jurisdiction.');
	if (!Number.isInteger(calendar.year) || calendar.year < 1 || calendar.year > 9999)
		refuse('A holiday calendar needs a year between 1 and 9999.');
	if (!Number.isInteger(calendar.revision) || calendar.revision < 1)
		refuse('A holiday calendar revision must be a positive integer.');
	const dates = new Set<string>();
	for (const observation of calendar.observations) {
		if (!isCalendarDate(observation.date) || Number(observation.date.slice(0, 4)) !== calendar.year)
			refuse(`Observed date ${observation.date} must belong to calendar year ${calendar.year}.`);
		if (!observation.name.trim()) refuse('Each observed holiday needs a name.');
		if (observation.original_date != null && !isCalendarDate(observation.original_date))
			refuse(`Original holiday date ${observation.original_date} is invalid.`);
		if (dates.has(observation.date))
			refuse(`Observed date ${observation.date} occurs more than once.`);
		dates.add(observation.date);
	}
}

/** Resolve complete annual coverage once. Unpublished or missing years never imply no holidays. */
export function resolveHolidayCalendars(
	rows: readonly HolidayCalendar[],
	jurisdictionCode: string,
	start: string,
	end: string
): {
	readonly calendars: readonly HolidayCalendarSnapshot[];
	readonly holidays: ReadonlyMap<string, HolidayObservation>;
} {
	if (!isCalendarDate(start) || !isCalendarDate(end) || start > end)
		refuse('Holiday calendar coverage needs a valid ordered date range.');
	const calendars: HolidayCalendarSnapshot[] = [];
	const holidays = new Map<string, HolidayObservation>();
	for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
		const candidates = rows
			.filter(
				(row) =>
					row.jurisdiction_code === jurisdictionCode &&
					row.year === year &&
					row.published_at != null
			)
			.toSorted((a, b) => b.revision - a.revision);
		const calendar = candidates[0];
		if (!calendar || calendar.published_at == null)
			refuse(
				`Publish the ${jurisdictionCode} holiday calendar for ${year} before calculating this period.`
			);
		if (candidates[1]?.revision === calendar.revision)
			refuse(`Holiday calendar ${jurisdictionCode} ${year} has duplicate published revisions.`);
		validateHolidayCalendar(calendar);
		// Keep values as well as revision IDs: a hash or a live query cannot reproduce an old result.
		const snapshot = {
			id: calendar.id,
			jurisdiction_code: calendar.jurisdiction_code,
			year: calendar.year,
			revision: calendar.revision,
			published_at: calendar.published_at,
			observations: structuredClone(calendar.observations)
		};
		calendars.push(snapshot);
		for (const observation of snapshot.observations) holidays.set(observation.date, observation);
	}
	return { calendars, holidays };
}
