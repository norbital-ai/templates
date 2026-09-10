import {
	readRows,
	readSheetTable,
	WorkbookImportError,
	type WorkbookGrids
} from './workbook-rows.js';

const HOLIDAYS_SHEET_NAME = 'Holidays';

/**
 * One row of the holidays workbook, before the entity is resolved.
 *
 * The sheet names an entity the way every other operator workbook does — by its legal name or its
 * registration number — and one file may carry every entity at once, which is the point: a payroll
 * team maintains one annual calendar spreadsheet, not one per company. Resolving the name to an id
 * is the pipeline's job, because only the server holds the entity list to resolve it against.
 */
type HolidayWorkbookRow = {
	readonly legal_entity: string;
	readonly date: string;
	readonly name: string;
	readonly original_date: string | null;
	readonly source: string | null;
};

/** The holidays workbook: one long-form sheet, one row per entity and day. */
export function holidayImportPayload(grids: WorkbookGrids): {
	readonly rows: readonly HolidayWorkbookRow[];
} {
	const table = readSheetTable(grids, HOLIDAYS_SHEET_NAME, ['legal_entity', 'date', 'name']);
	const rows = readRows(
		table,
		(reader) =>
			`Row ${reader.rowNumber} (${reader.text('legal_entity') ?? ''} ${reader.text('date') ?? ''})`,
		(reader): HolidayWorkbookRow => ({
			legal_entity: reader.requiredText('legal_entity') ?? '',
			date: reader.calendarDate('date') ?? '',
			name: reader.requiredText('name') ?? '',
			original_date:
				reader.text('original_date') == null
					? null
					: (reader.calendarDate('original_date') ?? null),
			source: 'spreadsheet'
		})
	);
	if (rows.length === 0) throw new WorkbookImportError('This file has no holidays to import.');
	return { rows };
}
