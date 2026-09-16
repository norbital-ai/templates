import type { HolidaySnapshot } from '../datatypes/holiday_snapshots/+definition.js';
import { resolveHolidays, type HolidayRow } from './holiday-calendar.js';
import { dateKey } from './iso-day.js';

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
