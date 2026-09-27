import type { Id, QueryCtx } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { isCalendarDate } from './iso-day.js';

/** A holiday as an import proposes it: the spreadsheet's row, its entity resolved. */
export type HolidayImportRow = {
	readonly company_id: string;
	readonly date: string;
	readonly name: string;
	readonly replaces: string | null;
	readonly source: string | null;
};

/** Why a proposed row was not written, in the words the operator gets back. */
export type HolidayImportSkip = {
	readonly company_id: string;
	readonly date: string;
	readonly name: string;
	readonly reason: 'DUPLICATE_IN_FILE' | 'ALREADY_PRESENT';
};

/**
 * The one import path. Every proposed row is checked; a day the entity already has is skipped rather than duplicated
 * or overwritten, whether the existing row is published, consumed or a draft. What comes back is exactly the rows to
 * insert, unpublished (an import proposes, a person publishes), and every row read and not written with its reason:
 * a mistyped entity and a day already on file are both "skipped" and need different fixes.
 */
export async function dedupeHolidayRows(
	ctx: Pick<QueryCtx, 'read'>,
	rows: readonly HolidayImportRow[],
	refuse: (message: string) => never
): Promise<{
	readonly inserts: readonly HolidayImportRow[];
	readonly reconciliation: readonly HolidayImportSkip[];
}> {
	const proposed = new Map<string, HolidayImportRow>();
	const reconciliation: HolidayImportSkip[] = [];
	for (const row of rows) {
		const code = row.company_id.trim();
		const date = row.date.trim();
		if (!code) refuse(`Row ${date} ${row.name}: a holiday needs the entity that observes it.`);
		if (!isCalendarDate(date)) refuse(`Row ${code} ${row.name}: ${date} is not a calendar day.`);
		if (!row.name.trim()) refuse(`Row ${code} ${date}: a holiday needs a name.`);
		if (row.replaces != null && !isCalendarDate(row.replaces))
			refuse(`Row ${code} ${date}: replaced date ${row.replaces} is not a calendar day.`);
		// The last statement of a day wins within one file: a sheet repeating a day is a sheet that was edited, not two
		// holidays. It is reported rather than silent.
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
			replaces: row.replaces,
			source: row.source
		});
	}
	if (proposed.size === 0) return { inserts: [], reconciliation };
	const companies = [
		...new Set([...proposed.values()].map((row) => row.company_id))
	] as Id<'companies'>[];
	const dates = [...proposed.values()].map((row) => row.date).toSorted();
	const { rows: existing } = await ctx.read('jurisdiction_holidays', {
		where: {
			company_id: { in: companies },
			date: { gte: PlainDate(dates[0]!), lte: PlainDate(dates.at(-1)!) },
			approval_id: { isNull: true }
		},
		select: { company_id: true, date: true },
		all: true
	});
	const held = new Set(existing.map((row) => `${row.company_id} ${String(row.date)}`));
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
	return { inserts, reconciliation };
}
