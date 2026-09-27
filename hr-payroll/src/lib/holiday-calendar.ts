import { refuse } from './refuse.js';
import { isCalendarDate } from './iso-day.js';
import type { WorkspaceRow } from './rows.js';
import { HOLIDAY_KINDS, type HolidaySnapshot } from './datatypes/holiday_snapshots.js';
import { dateKey } from './iso-day.js';

/** What a consumer reads off a holiday row; the snapshot is the same columns, dates as day keys. */
export type HolidayRow = Pick<
	WorkspaceRow<'jurisdiction_holidays'>,
	'id' | 'company_id' | 'date' | 'name' | 'kind' | 'replaces' | 'given_to' | 'published_at'
>;

/** The row exactly as a run captures it. An unpublished pin is still evidence, so it is not refused. */
function holidaySnapshot(row: HolidayRow): HolidaySnapshot {
	return {
		id: row.id,
		company_id: row.company_id,
		date: dateKey(row.date),
		name: row.name,
		kind: HOLIDAY_KINDS.find((kind) => kind === row.kind) ?? 'PUBLIC_HOLIDAY',
		replaces: row.replaces == null ? null : dateKey(row.replaces),
		given_to:
			row.given_to === 'ONLY_IF_OFF_ON_REPLACED_DATE' ? 'ONLY_IF_OFF_ON_REPLACED_DATE' : 'EVERYONE',
		published_at: row.published_at == null ? '' : row.published_at
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
		if (holidays.has(date)) refuse(`Entity ${companyId} has two published holidays on ${date}.`);
		holidays.set(date, holidaySnapshot(row));
	}
	return holidays;
}

/** One classified day: the holiday it was read against, or none. */
export type PreparedHolidayInput = {
	readonly company_id: string;
	readonly date: string;
	readonly holiday_id: string | null;
};

/** Classifies every requested day against what the entity's calendar publishes at the point of running. */
export function resolveHolidayInputs(
	rows: readonly HolidayRow[],
	companyId: string,
	dates: readonly string[]
): {
	readonly holidays: ReadonlyMap<string, HolidaySnapshot>;
	readonly snapshots: readonly HolidaySnapshot[];
	readonly inputs: readonly PreparedHolidayInput[];
} {
	const ordered = [...new Set(dates.map(dateKey))].sort();
	if (!ordered.length) return { holidays: new Map(), snapshots: [], inputs: [] };
	const holidays = new Map(resolveHolidays(rows, companyId, ordered[0]!, ordered.at(-1)!));
	const inputs = ordered.map((date) => ({
		company_id: companyId,
		date,
		holiday_id: holidays.get(date)?.id ?? null
	}));
	return {
		holidays,
		snapshots: [...holidays.values()].toSorted((a, b) => a.date.localeCompare(b.date)),
		inputs
	};
}
