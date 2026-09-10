import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { PayrollReadApi } from '../collections/payroll_runs/lib/api.js';
import type { HolidaySnapshot } from '../datatypes/holiday_snapshots/+definition.js';
import { holidaySnapshot, resolveHolidays, type HolidayRow } from './holiday-calendar.js';
import { dateKey } from './iso-day.js';

/** One classified day: the holiday it was read against, or none. */
export type PreparedHolidayInput = {
	readonly company_id: string;
	readonly date: string;
	readonly holiday_id: string | null;
};
type HolidayInputApi = {
	readonly db: Pick<PayrollReadApi['db'], 'jurisdiction_holidays'>;
};
const LIMIT = 20_000;

/**
 * Classifies every requested day: what is published at the point of running, except where a work
 * day already pinned a holiday — that pin stays the day's holiday even if the row was unpublished
 * or changed since, because it is what the day was classified against.
 */
export function resolveHolidayInputs(
	rows: readonly HolidayRow[],
	companyId: string,
	dates: readonly string[],
	pinned: readonly PreparedHolidayInput[] = []
): {
	readonly holidays: ReadonlyMap<string, HolidaySnapshot>;
	readonly snapshots: readonly HolidaySnapshot[];
	readonly inputs: readonly PreparedHolidayInput[];
} {
	const ordered = [...new Set(dates.map(dateKey))].sort();
	if (!ordered.length) return { holidays: new Map(), snapshots: [], inputs: [] };
	const holidays = new Map(resolveHolidays(rows, companyId, ordered[0]!, ordered.at(-1)!));
	const requested = new Set(ordered);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const pinnedByDate = new Map<string, string>();
	for (const input of pinned) {
		const date = dateKey(input.date);
		if (
			input.company_id !== companyId ||
			!requested.has(date) ||
			input.holiday_id == null
		)
			continue;
		const previous = pinnedByDate.get(date);
		if (previous !== undefined && previous !== input.holiday_id)
			refuse(`Work holiday inputs disagree on the observed holiday for ${companyId} ${date}.`);
		pinnedByDate.set(date, input.holiday_id);
		const row = byId.get(input.holiday_id);
		if (!row) refuse(`Work holiday input ${date} references a missing holiday.`);
		holidays.set(date, holidaySnapshot(row));
	}
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

export const prepareHolidayInputs = (
	api: HolidayInputApi,
	companyId: string,
	dates: readonly string[]
) =>
	Effect.gen(function* () {
		const ordered = [...new Set(dates.map(dateKey))].sort();
		if (!ordered.length) return resolveHolidayInputs([], companyId, []);
		const rows = yield* api.db.jurisdiction_holidays.findMany({
			where: {
				company_id: { eq: companyId },
				date: { gte: ordered[0]!, lte: ordered.at(-1)! },
				approval_id: { isNull: true }
			},
			limit: LIMIT
		});
		if (rows.length >= LIMIT) refuse('Holiday preparation exceeded its complete-read limit.');
		return resolveHolidayInputs(rows, companyId, ordered);
	});
