/** Browser-side parsing for the monthly roster workbook. */
import {
	identifyRowByColumns,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type RowReader,
	type WorkbookGrids
} from '../../../lib/workbook-rows.js';
import {
	expandRosterMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders
} from '../../time_entries/import-month-grid.js';
import { Schema } from 'effect';
import { readWorkbookSettings } from '../../../lib/workbook-settings.js';

const ROSTER_SHEET_NAME = 'Roster';
const LONG_FORM_COLUMNS = ['employee_number', 'work_date', 'shift_code'] as const;

/** `shift_code` is a real company roster code, or the reserved import token PH. */
const rosterImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	shift_code: Schema.String,
	assignment_code: Schema.optional(Schema.String),
	note: Schema.optional(Schema.String)
});
type RosterImportRow = Schema.Schema.Type<typeof rosterImportRowSchema>;

const rosterImportPayloadSchema = Schema.Struct({
	roster_id: Schema.String,
	legal_entity: Schema.optional(Schema.String),
	month: Schema.optional(Schema.String),
	rows: Schema.Array(rosterImportRowSchema)
});
type RosterImportPayload = Schema.Schema.Type<typeof rosterImportPayloadSchema>;

function identifyRosterRow(reader: RowReader): string {
	return identifyRowByColumns(reader, ['employee_number', 'work_date']);
}

function longFormRosterRows(grids: WorkbookGrids): readonly RosterImportRow[] {
	const table = readSheetTable(grids, ROSTER_SHEET_NAME, LONG_FORM_COLUMNS);
	const parsed = readRows(table, identifyRosterRow, (reader) => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		shift_code: reader.text('shift_code'),
		assignment_code: reader.text('assignment_code'),
		note: reader.text('note')
	}));
	return parsed.flatMap((row): RosterImportRow[] =>
		row.shift_code == null
			? []
			: [
					{
						employee_number: row.employee_number,
						work_date: row.work_date,
						shift_code: row.shift_code,
						assignment_code: row.assignment_code,
						note: row.note
					}
				]
	);
}

/**
 * Blank shift cells are absent assignments, not inferred rest days.
 *
 * The issued template is a month grid (one person per row, one day per column). A long-form sheet
 * with `work_date` still imports, including the files operators already have on disk.
 */
export function rosterImportPayload(grids: WorkbookGrids, rosterId: string): RosterImportPayload {
	const settings = readWorkbookSettings(grids);
	const table = readSheetTable(grids, ROSTER_SHEET_NAME, ['employee_number']);
	let rows: readonly RosterImportRow[];
	if (isLongFormImportHeaders(table.headers)) {
		rows = longFormRosterRows(grids);
	} else if (isMonthGridImportHeaders(table.headers)) {
		rows = expandRosterMonthGrid(table, settings.month);
	} else {
		throw new WorkbookImportError('The "Roster" sheet is missing the columns the import needs.', [
			'A month grid needs day-number or YYYY-MM-DD columns, as the import template has.',
			'A long-form sheet needs employee_number, work_date and shift_code.',
			`Columns found: ${table.headers.filter((header) => header !== '').join(', ') || '(none)'}.`
		]);
	}
	if (rows.length === 0) {
		throw new WorkbookImportError('This file has no roster assignments to import.');
	}
	return {
		roster_id: rosterId,
		legal_entity: settings.legal_entity,
		month: settings.month,
		rows
	};
}
