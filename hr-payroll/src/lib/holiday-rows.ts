import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { Api } from '../collections/jurisdiction_holidays/$types.js';
import { dateKey } from './iso-day.js';

/** A holiday as an import proposes it: the spreadsheet's row or a Google event's day. */
export type HolidayImportRow = {
	readonly jurisdiction_code: string;
	readonly date: string;
	readonly name: string;
	readonly original_date: string | null;
	readonly source: string | null;
};

const LIMIT = 20_000;

/**
 * The one import path, whichever door the rows came through.
 *
 * Every proposed row is checked; a day the jurisdiction already has is skipped rather than
 * duplicated or overwritten, whether the existing row is published, consumed or a draft. What
 * comes back is exactly the rows to insert, unpublished: an import proposes, a person publishes.
 */
export const dedupeHolidayRows = (
	api: Pick<Api, 'db'>,
	rows: readonly HolidayImportRow[]
): Effect.Effect<{
	readonly inserts: readonly HolidayImportRow[];
	readonly skipped: number;
}> =>
	Effect.gen(function* () {
		const proposed = new Map<string, HolidayImportRow>();
		for (const row of rows) {
			const code = row.jurisdiction_code.trim();
			const date = row.date.trim();
			if (!code) refuse(`Row ${date} ${row.name}: a holiday needs a jurisdiction.`);
			if (!isCalendarDate(date)) refuse(`Row ${code} ${row.name}: ${date} is not a calendar day.`);
			if (!row.name.trim()) refuse(`Row ${code} ${date}: a holiday needs a name.`);
			if (row.original_date != null && !isCalendarDate(row.original_date))
				refuse(`Row ${code} ${date}: original date ${row.original_date} is not a calendar day.`);
			// The last statement of a day wins within one file, silently: a sheet repeating a day is
			// a sheet that was edited, not two holidays.
			proposed.set(`${code} ${date}`, {
				jurisdiction_code: code,
				date,
				name: row.name.trim(),
				original_date: row.original_date,
				source: row.source
			});
		}
		if (proposed.size === 0) return { inserts: [], skipped: 0 };
		const codes = [...new Set([...proposed.values()].map((row) => row.jurisdiction_code))];
		const dates = [...proposed.values()].map((row) => row.date).toSorted();
		const existing = yield* api.db.jurisdiction_holidays.findMany({
			where: {
				jurisdiction_code: { in: codes },
				date: { gte: dates[0]!, lte: dates.at(-1)! },
				approval_id: { isNull: true }
			},
			columns: { jurisdiction_code: true, date: true },
			limit: LIMIT
		});
		if (existing.length >= LIMIT) refuse('Holiday import exceeded its complete-read limit.');
		const held = new Set(existing.map((row) => `${row.jurisdiction_code} ${dateKey(row.date)}`));
		const inserts = [...proposed.entries()].filter(([key]) => !held.has(key)).map(([, row]) => row);
		return { inserts, skipped: proposed.size - inserts.length };
	});
