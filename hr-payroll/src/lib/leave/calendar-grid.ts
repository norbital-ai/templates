/**
 * The leave picker's visible month, as a Monday-first 42-day grid.
 *
 * The preview remote and the range picker must name the same days: availability is computed for
 * this window, and a day the picker draws that the remote did not answer would default to eligible.
 */

const DAY_MS = 86_400_000;
const GRID_DAYS = 42;

function addCalendarDays(date: string, amount: number): string {
	return new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

/** First and last calendar day of the 42-cell grid that paints `YYYY-MM`. */
export function leaveCalendarGridBounds(month: string): {
	readonly start: string;
	readonly end: string;
} {
	const first = `${month}-01`;
	const weekday = new Date(`${first}T00:00:00.000Z`).getUTCDay();
	const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
	const start = addCalendarDays(first, mondayOffset);
	return { start, end: addCalendarDays(start, GRID_DAYS - 1) };
}

/** The 42 dates the leave picker draws for `YYYY-MM`, Monday-first including spill from adjacent months. */
export function leaveCalendarGrid(month: string): readonly string[] {
	const { start } = leaveCalendarGridBounds(month);
	return Array.from({ length: GRID_DAYS }, (_unused, index) => addCalendarDays(start, index));
}

/** Inclusive calendar days from `start` through `end`. */
export function calendarDaysThrough(start: string, end: string): readonly string[] {
	if (end < start) return [];
	const days: string[] = [];
	for (let cursor = start; cursor <= end; cursor = addCalendarDays(cursor, 1)) {
		days.push(cursor);
	}
	return days;
}
