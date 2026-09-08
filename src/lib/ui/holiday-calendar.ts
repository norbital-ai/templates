import { resolveHolidayCalendars, type HolidayCalendar } from '../holiday-calendar.js';

export const HOLIDAY_CALENDAR_QUERY_LIMIT = 200;

/** Resolve loaded calendar rows for both attendance views; each view owns its live queries. */
export function holidayCalendarView(input: {
	readonly settingsCount: number | undefined;
	readonly jurisdiction: string | null;
	readonly calendars: readonly HolidayCalendar[] | undefined;
	readonly start: string;
	readonly end: string;
	readonly noJurisdiction: string;
	readonly truncated: string;
}): { readonly holidays: HolidayCalendar['observations']; readonly error: string | null } {
	if (input.settingsCount !== undefined && input.jurisdiction == null)
		return { holidays: [], error: input.noJurisdiction };
	if (
		(input.settingsCount ?? 0) >= HOLIDAY_CALENDAR_QUERY_LIMIT ||
		(input.calendars?.length ?? 0) >= HOLIDAY_CALENDAR_QUERY_LIMIT
	)
		return { holidays: [], error: input.truncated };
	if (input.jurisdiction == null || input.calendars === undefined)
		return { holidays: [], error: null };
	try {
		return {
			holidays: [
				...resolveHolidayCalendars(
					input.calendars,
					input.jurisdiction,
					input.start,
					input.end
				).holidays.values()
			],
			error: null
		};
	} catch (error) {
		return { holidays: [], error: error instanceof Error ? error.message : String(error) };
	}
}
