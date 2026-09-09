import { resolveHolidays, type HolidayRow } from '../holiday-calendar.js';
import type { HolidaySnapshot } from '../../datatypes/holiday_snapshots/+definition.js';

export const HOLIDAY_QUERY_LIMIT = 200;

/** The published holidays a roster or schedule overlays for one period; each view owns its live queries. */
export function holidayView(input: {
	readonly settingsCount: number | undefined;
	readonly jurisdiction: string | null;
	readonly rows: readonly HolidayRow[] | undefined;
	readonly start: string;
	readonly end: string;
	readonly noJurisdiction: string;
	readonly truncated: string;
}): { readonly holidays: readonly HolidaySnapshot[]; readonly error: string | null } {
	if (input.settingsCount !== undefined && input.jurisdiction == null)
		return { holidays: [], error: input.noJurisdiction };
	if (
		(input.settingsCount ?? 0) >= HOLIDAY_QUERY_LIMIT ||
		(input.rows?.length ?? 0) >= HOLIDAY_QUERY_LIMIT
	)
		return { holidays: [], error: input.truncated };
	if (input.jurisdiction == null || input.rows === undefined) return { holidays: [], error: null };
	try {
		return {
			holidays: [
				...resolveHolidays(input.rows, input.jurisdiction, input.start, input.end).values()
			],
			error: null
		};
	} catch (error) {
		return { holidays: [], error: error instanceof Error ? error.message : String(error) };
	}
}
