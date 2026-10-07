import type { Id } from '@norbital-ai/bolt';

/**
 * L-TPL-hr-payroll-115: spreadsheet holidays land unpublished; a day the entity already has is skipped.
 */
export type HolidayDraft = {
	readonly company_id: Id<'entity'>;
	readonly date: string;
	readonly name: string;
	readonly replaces?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cell(row: readonly unknown[], index: number): string {
	return String(row[index] ?? '').trim();
}

export function parseEntityHolidaySheets(
	sheets: Iterable<readonly [string, readonly (readonly unknown[])[]]>,
	entities: readonly { readonly id: Id<'entity'>; readonly name: string }[]
):
	| { readonly rows: readonly HolidayDraft[] }
	| { readonly error: string; readonly detail?: readonly string[] } {
	const byName = new Map(entities.map((row) => [row.name.trim().toLowerCase(), row.id]));
	const rows: HolidayDraft[] = [];
	for (const [sheet, table] of sheets) {
		const sheetName = sheet.trim();
		if (sheetName === '' || sheetName.toLowerCase() === 'read me first') continue;
		const company_id = byName.get(sheetName.toLowerCase());
		if (company_id == null)
			return {
				error: `Sheet "${sheetName}" names no entity of this workspace.`,
				detail: [`Known entities: ${[...byName.keys()].join(', ')}.`]
			};
		const [header, ...body] = table;
		if (header == null) continue;
		const columns = header.map((value) =>
			String(value ?? '')
				.trim()
				.toLowerCase()
		);
		const dateColumn = columns.indexOf('date');
		const nameColumn = columns.indexOf('name');
		const replacesColumn = columns.indexOf('replaces');
		if (dateColumn < 0 || nameColumn < 0)
			return { error: `Sheet "${sheetName}" needs a date and a name column.` };
		for (const row of body) {
			const date = cell(row, dateColumn);
			if (date === '') continue;
			if (!DATE.test(date))
				return { error: `Sheet "${sheetName}" has a date that is not YYYY-MM-DD (${date}).` };
			const name = cell(row, nameColumn);
			const replaces = replacesColumn < 0 ? '' : cell(row, replacesColumn);
			if (replaces !== '' && !DATE.test(replaces))
				return {
					error: `Sheet "${sheetName}" has a replaces date that is not YYYY-MM-DD (${replaces}).`
				};
			rows.push({
				company_id,
				date,
				name,
				...(replaces === '' ? {} : { replaces })
			});
		}
	}
	return { rows };
}

export function skipHeldHolidays(
	proposed: readonly HolidayDraft[],
	held: readonly { readonly company_id: string; readonly date: string }[]
): { readonly insert: readonly HolidayDraft[]; readonly skipped: number } {
	const existing = new Set(held.map((row) => `${row.company_id}|${String(row.date).slice(0, 10)}`));
	const insert: HolidayDraft[] = [];
	let skipped = 0;
	const seen = new Set<string>();
	for (const row of proposed) {
		const key = `${row.company_id}|${row.date}`;
		if (existing.has(key) || seen.has(key)) {
			skipped += 1;
			continue;
		}
		seen.add(key);
		insert.push(row);
	}
	return { insert, skipped };
}
