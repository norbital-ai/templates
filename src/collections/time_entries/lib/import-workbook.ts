/**
 * The time-entries import workbook, as the shape `time_entries/+pipelines.ts` accepts.
 *
 * Clock cells stay local wall-clock text here. The file states its own timezone once, on the
 * `Settings` sheet, and the pipeline resolves both together into UTC instants — so a punch is
 * converted where the zone is known rather than in the browser that happened to open the file.
 */

import {
	findSheet,
	identifyRowByColumns,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type RowReader,
	type WorkbookGrids
} from '../../../lib/workbook-rows.js';

export const TIME_ENTRY_SHEET_NAME = 'Time entries';
export const SETTINGS_SHEET_NAME = 'Settings';
const REQUIRED_COLUMNS = ['employee_number', 'work_date'] as const;

export interface TimeEntryImportRow {
	readonly employee_number: string;
	readonly work_date: string;
	readonly clock_in?: string;
	readonly clock_out?: string;
	readonly break_minutes?: number;
	readonly reason?: string;
}

export interface TimeEntryImportPayload {
	readonly timezone: string;
	readonly rows: readonly TimeEntryImportRow[];
}

/**
 * The timezone the file's clock times are read in.
 *
 * There is no fallback to the browser's own zone. A punch imported into the wrong zone is off by
 * hours and still looks like a plausible day's work, so a file that does not say which zone it means
 * is refused rather than guessed at.
 */
export function timeEntryImportTimezone(grids: WorkbookGrids): string {
	const settings = findSheet(grids, SETTINGS_SHEET_NAME);
	const row = settings?.find(
		(cells) =>
			String(cells[0] ?? '')
				.trim()
				.toLowerCase() === 'timezone'
	);
	const timezone = String(row?.[1] ?? '').trim();
	if (timezone === '') {
		throw new WorkbookImportError(
			'This file does not say which timezone its clock times are in, so they cannot be imported.',
			[
				`Add a "${SETTINGS_SHEET_NAME}" sheet with a "timezone" row, as the import template has.`,
				'Use an IANA name that identifies the place — Asia/Kuala_Lumpur, not a fixed UTC offset.'
			]
		);
	}
	return timezone;
}

function identifyTimeEntryRow(reader: RowReader): string {
	return identifyRowByColumns(reader, ['employee_number', 'work_date']);
}

/** Builds the import payload from the `Time entries` sheet and the file's declared timezone. */
export function timeEntryImportPayload(grids: WorkbookGrids): TimeEntryImportPayload {
	const timezone = timeEntryImportTimezone(grids);
	const table = readSheetTable(grids, TIME_ENTRY_SHEET_NAME, REQUIRED_COLUMNS);
	// An empty cell reads as absent, not as a value. The pipeline takes each of these as optional and
	// derives whether the final interval is open from whether a close arrived. `JSON.stringify`
	// drops an undefined property on the way out, so absence travels as
	// absence.
	//
	// Legacy overtime/state columns are intentionally ignored. Overtime is calculated from actual
	// presence and the effective schedule; a workbook cannot assert it as a second class of time.
	const rows = readRows(table, identifyTimeEntryRow, (reader): TimeEntryImportRow => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		clock_in: reader.clockTime('clock_in'),
		clock_out: reader.clockTime('clock_out'),
		break_minutes: reader.wholeNumber('break_minutes'),
		reason: reader.text('reason')
	}));
	return { timezone, rows };
}
