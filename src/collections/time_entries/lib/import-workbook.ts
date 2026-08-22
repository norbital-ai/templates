/**
 * The time-entries import workbook, as the shape `time_entries/+pipelines.ts` accepts.
 *
 * Clock cells stay local wall-clock text here. The file states its own timezone once, on the
 * `Settings` sheet, and the pipeline resolves both together into UTC instants — so a punch is
 * converted where the zone is known rather than in the browser that happened to open the file.
 *
 * The issued template is one legal entity × one month: a person down the side and a calendar day
 * across the top, each cell `HH:mm-HH:mm` (or `HH:mm` when still open). A long-form sheet with
 * `work_date` / `clock_in` / `clock_out` still imports.
 */

import {
	identifyRowByColumns,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type RowReader,
	type WorkbookGrids
} from '../../../lib/workbook-rows.js';
import {
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders
} from '../import-month-grid.js';
import { Schema } from 'effect';
import { readWorkbookSettings, SETTINGS_SHEET_NAME } from '../../../lib/workbook-settings.js';

const TIME_ENTRY_SHEET_NAME = 'Time entries';
const LONG_FORM_COLUMNS = ['employee_number', 'work_date'] as const;

const timeEntryImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	clock_in: Schema.optional(Schema.String),
	clock_out: Schema.optional(Schema.String),
	break_minutes: Schema.optional(Schema.Number)
});
type TimeEntryImportRow = Schema.Schema.Type<typeof timeEntryImportRowSchema>;

const timeEntryImportPayloadSchema = Schema.Struct({
	timezone: Schema.String,
	legal_entity: Schema.optional(Schema.String),
	month: Schema.optional(Schema.String),
	rows: Schema.Array(timeEntryImportRowSchema)
});
type TimeEntryImportPayload = Schema.Schema.Type<typeof timeEntryImportPayloadSchema>;

function identifyTimeEntryRow(reader: RowReader): string {
	return identifyRowByColumns(reader, ['employee_number', 'work_date']);
}

function longFormTimeRows(grids: WorkbookGrids): readonly TimeEntryImportRow[] {
	const table = readSheetTable(grids, TIME_ENTRY_SHEET_NAME, LONG_FORM_COLUMNS);
	// An empty cell reads as absent, not as a value. The pipeline takes each of these as optional and
	// derives whether the final interval is open from whether a close arrived. `JSON.stringify`
	// drops an undefined property on the way out, so absence travels as
	// absence.
	//
	// Overtime is calculated from actual presence and the effective schedule; a workbook cannot
	// assert it as a second class of time, so any overtime/state column is never read.
	return readRows(table, identifyTimeEntryRow, (reader): TimeEntryImportRow => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		clock_in: reader.clockTime('clock_in'),
		clock_out: reader.clockTime('clock_out'),
		break_minutes: reader.wholeNumber('break_minutes')
	}));
}

/** Builds the import payload from the `Time entries` sheet and the file's declared timezone.
 *
 * There is no fallback to the browser's own zone. A punch imported into the wrong zone is off by
 * hours and still looks like a plausible day's work, so a file that does not say which zone it means
 * is refused rather than guessed at.
 */
export function timeEntryImportPayload(grids: WorkbookGrids): TimeEntryImportPayload {
	const settings = readWorkbookSettings(grids);
	const timezone = settings.timezone;
	if (timezone == null || timezone === '') {
		throw new WorkbookImportError(
			'This file does not say which timezone its clock times are in, so they cannot be imported.',
			[
				`Add a "${SETTINGS_SHEET_NAME}" sheet with a "timezone" row, as the import template has.`,
				'Use an IANA name that identifies the place — Asia/Kuala_Lumpur, not a fixed UTC offset.'
			]
		);
	}
	const table = readSheetTable(grids, TIME_ENTRY_SHEET_NAME, ['employee_number']);
	let rows: readonly TimeEntryImportRow[];
	if (isLongFormImportHeaders(table.headers)) {
		rows = longFormTimeRows(grids);
	} else if (isMonthGridImportHeaders(table.headers)) {
		rows = expandTimeMonthGrid(table, settings.month);
	} else {
		throw new WorkbookImportError(
			'The "Time entries" sheet is missing the columns the import needs.',
			[
				'A month grid needs day-number or YYYY-MM-DD columns, as the import template has.',
				'A long-form sheet needs employee_number and work_date.',
				`Columns found: ${table.headers.filter((header) => header !== '').join(', ') || '(none)'}.`
			]
		);
	}
	if (rows.length === 0) {
		throw new WorkbookImportError('This file has no time entries to import.');
	}
	return {
		timezone,
		legal_entity: settings.legal_entity,
		month: settings.month,
		rows
	};
}
