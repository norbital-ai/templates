import type { HolidayImportRow } from './holiday-rows.js';
import {
	readRows,
	readSheetTable,
	WorkbookImportError,
	type WorkbookGrids
} from './workbook-rows.js';

const HOLIDAYS_SHEET_NAME = 'Holidays';

/** The holidays workbook: one long-form sheet, one row per jurisdiction and day. */
export function holidayImportPayload(grids: WorkbookGrids): {
	readonly rows: readonly HolidayImportRow[];
} {
	const table = readSheetTable(grids, HOLIDAYS_SHEET_NAME, ['jurisdiction_code', 'date', 'name']);
	const rows = readRows(
		table,
		(reader) =>
			`Row ${reader.rowNumber} (${reader.text('jurisdiction_code') ?? ''} ${reader.text('date') ?? ''})`,
		(reader): HolidayImportRow => ({
			jurisdiction_code: reader.requiredText('jurisdiction_code') ?? '',
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
