/**
 * The browser half of the `work_days` import: one collection, one workbook grammar, two sheets.
 *
 * `roster_entries/lib/import-workbook.ts` and `time_entries/lib/import-workbook.ts` were the same
 * file twice. Both read the `Settings` sheet through `readWorkbookSettings`, identified a row by
 * employee and day through `identifyRowByColumns`, collected every bad cell through `readRows` and
 * refused the whole file as one — and differed in the sheet they opened and the columns they read
 * out of it. Those two facts are now the arguments to `readSheet` below, and everything else is
 * said once.
 *
 * The two payloads stay two payloads, because they genuinely carry different header facts:
 *
 *     Roster       the drafted month the plan attaches to (`roster_id`)
 *     Attendance   the zone its clock cells are in (`timezone`)
 *
 * Neither is optional for its own sheet and neither means anything to the other, so they are two
 * arms of the pipeline's input union rather than one shape with two holes in it. `sheet` tags them,
 * so the pipeline dispatches on a literal rather than on which fields happen to be present.
 *
 * The issued template for both is one legal entity × one month: a person down the side and a
 * calendar day across the top. A long-form sheet still imports, including the files operators
 * already have on disk.
 */

import {
	identifyRowByColumns,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type RowReader,
	type SheetTable,
	type WorkbookGrids
} from '../../../lib/workbook-rows.js';
import {
	expandRosterMonthGrid,
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders
} from '../import-month-grid.js';
import { Schema } from 'effect';
import { readWorkbookSettings, SETTINGS_SHEET_NAME } from '../../../lib/workbook-settings.js';

const ROSTER_SHEET_NAME = 'Roster';
const ATTENDANCE_SHEET_NAME = 'Time entries';

/** `shift_code` is a real company roster code, or the reserved import token PH. */
const rosterImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	shift_code: Schema.String,
	assignment_code: Schema.optional(Schema.String),
	planned_note: Schema.optional(Schema.String)
});
type RosterImportRow = Schema.Schema.Type<typeof rosterImportRowSchema>;

const attendanceImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	clock_in: Schema.optional(Schema.String),
	clock_out: Schema.optional(Schema.String),
	break_minutes: Schema.optional(Schema.Number)
});
type AttendanceImportRow = Schema.Schema.Type<typeof attendanceImportRowSchema>;

const rosterImportPayloadSchema = Schema.Struct({
	sheet: Schema.Literal('ROSTER'),
	roster_id: Schema.String,
	legal_entity: Schema.optional(Schema.String),
	month: Schema.optional(Schema.String),
	rows: Schema.Array(rosterImportRowSchema)
});
type RosterImportPayload = Schema.Schema.Type<typeof rosterImportPayloadSchema>;

const attendanceImportPayloadSchema = Schema.Struct({
	sheet: Schema.Literal('ATTENDANCE'),
	timezone: Schema.String,
	legal_entity: Schema.optional(Schema.String),
	month: Schema.optional(Schema.String),
	rows: Schema.Array(attendanceImportRowSchema)
});
type AttendanceImportPayload = Schema.Schema.Type<typeof attendanceImportPayloadSchema>;

function identifyPersonDay(reader: RowReader): string {
	return identifyRowByColumns(reader, ['employee_number', 'work_date']);
}

/**
 * One sheet, read as either layout, or refused with the columns it does have.
 *
 * The choice between a month grid and a long-form table is the same choice for both sheets, made
 * from the same header row, and the refusal has to name the sheet and the columns either way. Only
 * the two expansions differ, so they are the parameters.
 */
function readSheet<TRow>(
	grids: WorkbookGrids,
	sheetName: string,
	options: {
		readonly longFormColumns: readonly string[];
		readonly longForm: (table: SheetTable) => readonly TRow[];
		readonly monthGrid: (table: SheetTable, month: string | undefined) => readonly TRow[];
	}
): readonly TRow[] {
	const settings = readWorkbookSettings(grids);
	const table = readSheetTable(grids, sheetName, ['employee_number']);
	if (isLongFormImportHeaders(table.headers)) {
		return options.longForm(readSheetTable(grids, sheetName, options.longFormColumns));
	}
	if (isMonthGridImportHeaders(table.headers)) {
		return options.monthGrid(table, settings.month);
	}
	throw new WorkbookImportError(`The "${sheetName}" sheet is missing the columns the import needs.`, [
		'A month grid needs day-number or YYYY-MM-DD columns, as the import template has.',
		`A long-form sheet needs ${options.longFormColumns.join(', ')}.`,
		`Columns found: ${table.headers.filter((header) => header !== '').join(', ') || '(none)'}.`
	]);
}

/** Blank shift cells are absent assignments, not inferred rest days. */
function longFormRosterRows(table: SheetTable): readonly RosterImportRow[] {
	const parsed = readRows(table, identifyPersonDay, (reader) => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		shift_code: reader.text('shift_code'),
		assignment_code: reader.text('assignment_code'),
		planned_note: reader.text('note')
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
						planned_note: row.planned_note
					}
				]
	);
}

/**
 * An empty clock cell reads as absent, not as a value. The pipeline takes each of these as optional
 * and derives whether the final interval is open from whether a close arrived. `JSON.stringify`
 * drops an undefined property on the way out, so absence travels as absence.
 *
 * Overtime is calculated from actual presence and the effective schedule; a workbook cannot assert
 * it as a second class of time, so any overtime/state column is never read.
 */
function longFormAttendanceRows(table: SheetTable): readonly AttendanceImportRow[] {
	return readRows(table, identifyPersonDay, (reader): AttendanceImportRow => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		clock_in: reader.clockTime('clock_in'),
		clock_out: reader.clockTime('clock_out'),
		break_minutes: reader.wholeNumber('break_minutes')
	}));
}

/** The planned half of the workbook, against the drafted month it is being imported into. */
export function rosterImportPayload(grids: WorkbookGrids, rosterId: string): RosterImportPayload {
	const settings = readWorkbookSettings(grids);
	const rows = readSheet<RosterImportRow>(grids, ROSTER_SHEET_NAME, {
		longFormColumns: ['employee_number', 'work_date', 'shift_code'],
		longForm: longFormRosterRows,
		monthGrid: expandRosterMonthGrid
	});
	if (rows.length === 0) {
		throw new WorkbookImportError('This file has no roster assignments to import.');
	}
	return {
		sheet: 'ROSTER',
		roster_id: rosterId,
		legal_entity: settings.legal_entity,
		month: settings.month,
		rows
	};
}

/**
 * The actual half of the workbook, and the file's declared timezone.
 *
 * Clock cells stay local wall-clock text here. The file states its own zone once, on the `Settings`
 * sheet, and the pipeline resolves both together into UTC instants — so a punch is converted where
 * the zone is known rather than in the browser that happened to open the file. There is no fallback
 * to the browser's own zone: a punch imported into the wrong zone is off by hours and still looks
 * like a plausible day's work, so a file that does not say which zone it means is refused rather
 * than guessed at.
 */
export function attendanceImportPayload(grids: WorkbookGrids): AttendanceImportPayload {
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
	const rows = readSheet<AttendanceImportRow>(grids, ATTENDANCE_SHEET_NAME, {
		longFormColumns: ['employee_number', 'work_date'],
		longForm: longFormAttendanceRows,
		monthGrid: expandTimeMonthGrid
	});
	if (rows.length === 0) {
		throw new WorkbookImportError('This file has no attendance to import.');
	}
	return {
		sheet: 'ATTENDANCE',
		timezone,
		legal_entity: settings.legal_entity,
		month: settings.month,
		rows
	};
}
