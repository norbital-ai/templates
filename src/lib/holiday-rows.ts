import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { Api } from '../collections/jurisdiction_holidays/$types.js';
import { dateKey } from './iso-day.js';

/** A holiday as an import proposes it: the spreadsheet's row or a Google event's day. */
export type HolidayImportRow = {
	readonly company_id: string;
	readonly date: string;
	readonly name: string;
	readonly original_date: string | null;
	readonly source: string | null;
};

const LIMIT = 20_000;

/** Why a proposed row was not written, in the words the operator gets back. */
type HolidayImportSkip = {
	readonly company_id: string;
	readonly date: string;
	readonly name: string;
	readonly reason: 'DUPLICATE_IN_FILE' | 'ALREADY_PRESENT';
};

/**
 * The one import path, whichever door the rows came through.
 *
 * Every proposed row is checked; a day the entity already has is skipped rather than
 * duplicated or overwritten, whether the existing row is published, consumed or a draft. What
 * comes back is exactly the rows to insert, unpublished: an import proposes, a person publishes.
 */
export const dedupeHolidayRows = (
	api: Pick<Api, 'db'>,
	rows: readonly HolidayImportRow[]
): Effect.Effect<{
	readonly inserts: readonly HolidayImportRow[];
	readonly skipped: number;
	/**
	 * Every row that was read and not written, with its reason.
	 *
	 * A count alone said "12 skipped" and left the operator to diff a spreadsheet against a table
	 * to find out which twelve and why. One file now carries every entity's calendar, so the answer
	 * matters more, not less: a mistyped entity name and a day the entity already has are both
	 * "skipped" and need completely different fixes.
	 */
	readonly reconciliation: readonly HolidayImportSkip[];
}> =>
	Effect.gen(function* () {
		const proposed = new Map<string, HolidayImportRow>();
		const reconciliation: HolidayImportSkip[] = [];
		for (const row of rows) {
			const code = row.company_id.trim();
			const date = row.date.trim();
			if (!code) refuse(`Row ${date} ${row.name}: a holiday needs the entity that observes it.`);
			if (!isCalendarDate(date)) refuse(`Row ${code} ${row.name}: ${date} is not a calendar day.`);
			if (!row.name.trim()) refuse(`Row ${code} ${date}: a holiday needs a name.`);
			if (row.original_date != null && !isCalendarDate(row.original_date))
				refuse(`Row ${code} ${date}: original date ${row.original_date} is not a calendar day.`);
			// The last statement of a day wins within one file: a sheet repeating a day is a sheet that
			// was edited, not two holidays. It is reported rather than silent.
			const key = `${code} ${date}`;
			const replaced = proposed.get(key);
			if (replaced != null)
				reconciliation.push({
					company_id: code,
					date,
					name: replaced.name,
					reason: 'DUPLICATE_IN_FILE'
				});
			proposed.set(key, {
				company_id: code,
				date,
				name: row.name.trim(),
				original_date: row.original_date,
				source: row.source
			});
		}
		if (proposed.size === 0) return { inserts: [], skipped: 0, reconciliation };
		const codes = [...new Set([...proposed.values()].map((row) => row.company_id))];
		const dates = [...proposed.values()].map((row) => row.date).toSorted();
		const existing = yield* api.db.jurisdiction_holidays.findMany({
			where: {
				company_id: { in: codes },
				date: { gte: dates[0]!, lte: dates.at(-1)! },
				approval_id: { isNull: true }
			},
			columns: { company_id: true, date: true },
			limit: LIMIT
		});
		if (existing.length >= LIMIT) refuse('Holiday import exceeded its complete-read limit.');
		const held = new Set(existing.map((row) => `${row.company_id} ${dateKey(row.date)}`));
		const inserts: HolidayImportRow[] = [];
		for (const [key, row] of proposed)
			if (held.has(key))
				reconciliation.push({
					company_id: row.company_id,
					date: row.date,
					name: row.name,
					reason: 'ALREADY_PRESENT'
				});
			else inserts.push(row);
		return { inserts, skipped: proposed.size - inserts.length, reconciliation };
	});
