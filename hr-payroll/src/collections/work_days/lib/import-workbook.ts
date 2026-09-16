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
 * One payload: the legal entity, month and timezone from the Settings sheet, the Roster sheet as
 * the plan and the Time entries sheet as the attendance. A sheet the file does not carry is
 * absent from the payload, which is how the pipeline knows to leave that half alone.
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

/** `shift_code` is one of the entity's roster codes: a shift, REST or OFF. */
const rosterImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	shift_code: Schema.String
});
type RosterImportRow = Schema.Schema.Type<typeof rosterImportRowSchema>;

const attendanceImportRowSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	clock_in: Schema.optional(Schema.String),
	clock_out: Schema.optional(Schema.String)
});
type AttendanceImportRow = Schema.Schema.Type<typeof attendanceImportRowSchema>;

/** The whole workbook. A sheet the file does not carry is absent; an empty sheet is `[]`. */
type SchedulingImportPayload = {
	readonly legal_entity: string;
	readonly month: string;
	readonly timezone?: string;
	readonly roster?: readonly RosterImportRow[];
	readonly attendance?: readonly AttendanceImportRow[];
};

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
	// A sheet with its header row and nothing under it is a statement, not a mistake: nothing is
	// planned, or nothing was worked, for the month.
	const cells = grids.get(sheetName) ?? [];
	const filled = cells.filter((row) =>
		row.some((cell) => cell != null && String(cell).trim() !== '')
	);
	if (filled.length === 1) return [];
	const table = readSheetTable(grids, sheetName, ['employee_number']);
	if (isLongFormImportHeaders(table.headers)) {
		return options.longForm(readSheetTable(grids, sheetName, options.longFormColumns));
	}
	if (isMonthGridImportHeaders(table.headers)) {
		return options.monthGrid(table, settings.month);
	}
	throw new WorkbookImportError(
		`The "${sheetName}" sheet is missing the columns the import needs.`,
		[
			'A month grid needs day-number or YYYY-MM-DD columns, as the import template has.',
			`A long-form sheet needs ${options.longFormColumns.join(', ')}.`,
			`Columns found: ${table.headers.filter((header) => header !== '').join(', ') || '(none)'}.`
		]
	);
}

/** Blank shift cells are absent assignments, not inferred rest days. */
function longFormRosterRows(table: SheetTable): readonly RosterImportRow[] {
	const parsed = readRows(table, identifyPersonDay, (reader) => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		shift_code: reader.text('shift_code')
	}));
	return parsed.flatMap((row): RosterImportRow[] =>
		row.shift_code == null
			? []
			: [
					{
						employee_number: row.employee_number,
						work_date: row.work_date,
						shift_code: row.shift_code
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
		clock_out: reader.clockTime('clock_out')
	}));
}

/**
 * The whole scheduling workbook: one legal entity and one month from the Settings sheet, the
 * Roster sheet as the plan and the Time entries sheet as the attendance. A sheet the file does
 * not carry stays absent, so the pipeline leaves that half of every day alone; a sheet it carries
 * empty is the statement that nothing is planned, or nothing was worked.
 *
 * Clock cells stay local wall-clock text here. The file states its own zone once, on `Settings`,
 * and the pipeline resolves both together into UTC instants — a punch imported into the wrong
 * zone is off by hours and still looks like a plausible day's work, so a file with punches and no
 * zone is refused by the pipeline rather than guessed at.
 */
export function schedulingImportPayload(grids: WorkbookGrids): SchedulingImportPayload {
	const settings = readWorkbookSettings(grids);
	const hasRoster = grids.has(ROSTER_SHEET_NAME);
	const hasAttendance = grids.has(ATTENDANCE_SHEET_NAME);
	if (!hasRoster && !hasAttendance)
		throw new WorkbookImportError(
			`This file has neither a "${ROSTER_SHEET_NAME}" nor a "${ATTENDANCE_SHEET_NAME}" sheet.`,
			['Start from the scheduling workbook template, which carries both.']
		);
	if (settings.legal_entity == null || settings.legal_entity === '')
		throw new WorkbookImportError('This file does not say which legal entity it is for.', [
			`Add a "legal_entity" row to the "${SETTINGS_SHEET_NAME}" sheet, as the template has.`
		]);
	if (settings.month == null || settings.month === '')
		throw new WorkbookImportError('This file does not say which month it is for.', [
			`Add a "month" row (YYYY-MM) to the "${SETTINGS_SHEET_NAME}" sheet, as the template has.`
		]);
	const roster = hasRoster
		? readSheet<RosterImportRow>(grids, ROSTER_SHEET_NAME, {
				longFormColumns: ['employee_number', 'work_date', 'shift_code'],
				longForm: longFormRosterRows,
				monthGrid: expandRosterMonthGrid
			})
		: undefined;
	const attendance = hasAttendance
		? readSheet<AttendanceImportRow>(grids, ATTENDANCE_SHEET_NAME, {
				longFormColumns: ['employee_number', 'work_date'],
				longForm: longFormAttendanceRows,
				monthGrid: expandTimeMonthGrid
			})
		: undefined;
	if ((roster?.length ?? 0) === 0 && (attendance?.length ?? 0) === 0)
		throw new WorkbookImportError('This file has nothing to import.', [
			'Fill the Roster sheet, the Time entries sheet, or both.'
		]);
	return {
		legal_entity: settings.legal_entity,
		month: settings.month,
		...(settings.timezone == null || settings.timezone === ''
			? {}
			: { timezone: settings.timezone }),
		...(roster === undefined ? {} : { roster }),
		...(attendance === undefined ? {} : { attendance })
	};
}
