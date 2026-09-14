import {
	findSheet,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type SheetCell,
	type WorkbookGrids
} from './workbook-rows.js';

const HOLIDAYS_SHEET_NAME = 'Holidays';
const README_SHEET_NAME = 'read me first';

/**
 * One row of the holidays workbook, before the entity is resolved.
 *
 * A sheet carries no entity column: the sheet itself is the entity in the bulk workbook — one
 * sheet per entity, named for it — and the open Holidays tab is the entity for a single import.
 * Either way a payroll team maintains one annual calendar workbook, not one file per company.
 * Resolving the name to an id is the pipeline's job, because only the server holds the entity
 * list to resolve it against.
 */
type HolidayWorkbookRow = {
	readonly legal_entity: string;
	readonly date: string;
	readonly name: string;
	readonly replaces: string | null;
	readonly source: string | null;
};

/** The readme and the sheets nobody typed in: not entities, whatever they are called. */
function isIgnoredSheet(name: string, grid: readonly (readonly SheetCell[])[]): boolean {
	if (name.trim().toLowerCase() === README_SHEET_NAME) return true;
	return grid.every((row) =>
		row.every((cell) => cell == null || (typeof cell === 'string' && cell.trim() === ''))
	);
}

/** The rows of one entity sheet, tagged with the entity they belong to. */
function readHolidaySheet(
	grids: WorkbookGrids,
	sheetName: string,
	legalEntity: string
): readonly HolidayWorkbookRow[] {
	const table = readSheetTable(grids, sheetName, ['date', 'name']);
	return readRows(
		table,
		(reader) => `Row ${reader.rowNumber} (${reader.text('date') ?? ''})`,
		(reader): HolidayWorkbookRow => ({
			legal_entity: legalEntity,
			date: reader.calendarDate('date') ?? '',
			name: reader.requiredText('name') ?? '',
			replaces: reader.text('replaces') == null ? null : (reader.calendarDate('replaces') ?? null),
			source: 'spreadsheet'
		})
	);
}

/**
 * The holidays workbook: one sheet per entity, each sheet named for the entity it lists.
 *
 * Every sheet but the readme is an entity, and its rows are that entity's days in the same
 * `date`, `name`, optional `replaces` shape the single import reads. A sheet naming no known
 * entity is the pipeline's refusal — only the server holds the list to resolve against — with
 * the known entities named beside it.
 */
export function holidayBulkImportPayload(grids: WorkbookGrids): {
	readonly rows: readonly HolidayWorkbookRow[];
} {
	const rows = [...grids.keys()]
		.filter((name) => !isIgnoredSheet(name, grids.get(name) ?? []))
		.flatMap((sheetName) => readHolidaySheet(grids, sheetName, sheetName));
	if (rows.length === 0) throw new WorkbookImportError('This file has no holidays to import.');
	return { rows };
}

/**
 * One entity's holidays, read from whichever sheet carries them.
 *
 * The sheet name is ignored and every row belongs to the company whose Holidays tab the import
 * runs from. A file with a `Holidays` sheet reads that one; any other single-sheet file — a CSV,
 * or one entity's sheet lifted out of the bulk workbook — reads its only sheet. A bulk workbook
 * with several entity sheets is refused rather than guessed at: attributing another entity's days
 * to this company is exactly what the company scoping exists to prevent.
 */
export function holidayCompanyImportPayload(
	companyName: string
): (grids: WorkbookGrids) => { readonly rows: readonly HolidayWorkbookRow[] } {
	return (grids) => {
		let sheetName: string | undefined;
		if (findSheet(grids, HOLIDAYS_SHEET_NAME) != null) sheetName = HOLIDAYS_SHEET_NAME;
		else {
			const candidates = [...grids.keys()].filter(
				(name) => !isIgnoredSheet(name, grids.get(name) ?? [])
			);
			if (candidates.length === 1) sheetName = candidates[0]!;
		}
		if (sheetName == null) {
			const names = [...grids.keys()].map((name) => `"${name}"`).join(', ');
			throw new WorkbookImportError(
				`This file has no "${HOLIDAYS_SHEET_NAME}" sheet, so there is nothing to import from it.`,
				[`The file contains: ${names}.`, 'Use the import template without renaming its sheets.']
			);
		}
		return { rows: readHolidaySheet(grids, sheetName, companyName) };
	};
}
