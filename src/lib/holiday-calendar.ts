import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import type { WorkspaceRow } from '../collections/jurisdiction_holidays/$types.js';
import type { HolidaySnapshot } from '../datatypes/holiday_snapshots/+definition.js';
import { dateKey } from './iso-day.js';

/** What a consumer reads off a holiday row; the snapshot is the same columns, dates as day keys. */
export type HolidayRow = Pick<
	WorkspaceRow<'jurisdiction_holidays'>,
	'id' | 'company_id' | 'date' | 'name' | 'kind' | 'original_date' | 'published_at'
>;

/** The row exactly as a run captures it. An unpublished pin is still evidence, so it is not refused. */
export function holidaySnapshot(row: HolidayRow): HolidaySnapshot {
	return {
		id: row.id,
		company_id: row.company_id,
		date: dateKey(row.date),
		name: row.name,
		kind: row.kind === 'SPECIAL' || row.kind === 'SUBSTITUTE' ? row.kind : 'PUBLIC',
		original_date: row.original_date == null ? null : dateKey(row.original_date),
		published_at: row.published_at ?? ''
	};
}

/**
 * The published holidays of one jurisdiction across a date range, by day.
 *
 * Publication is per holiday: a published row is a holiday, an unpublished one is not there.
 * Nothing asks a year to be complete first. A day a work day pinned is read back by id elsewhere,
 * published or not, because the pin is what the day was classified against.
 */
export function resolveHolidays(
	rows: readonly HolidayRow[],
	companyId: string,
	start: string,
	end: string
): ReadonlyMap<string, HolidaySnapshot> {
	if (!isCalendarDate(start) || !isCalendarDate(end) || start > end)
		refuse('Holiday coverage needs a valid ordered date range.');
	const holidays = new Map<string, HolidaySnapshot>();
	for (const row of rows) {
		if (row.company_id !== companyId || row.published_at == null) continue;
		const date = dateKey(row.date);
		if (date < start || date > end) continue;
		if (holidays.has(date))
			refuse(`Entity ${companyId} has two published holidays on ${date}.`);
		holidays.set(date, holidaySnapshot(row));
	}
	return holidays;
}
