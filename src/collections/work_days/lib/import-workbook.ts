/**
 * The browser half of the `work_days` import: one collection, one workbook grammar, three sheets.
 *
 * `roster_entries/lib/import-workbook.ts` and `time_entries/lib/import-workbook.ts` were the same
 * file twice. Both read the `Settings` sheet through `readWorkbookSettings`, identified a row by
 * employee and day through `identifyRowByColumns`, collected every bad cell through `readRows` and
 * refused the whole file as one — and differed in the sheet they opened and the columns they read
 * out of it. Those two facts are now the arguments to `readSheet` below, and everything else is
 * said once.
 *
 * One payload: the legal entity, month and timezone from the Settings sheet, the Roster sheet as
 * the plan, the Time entries sheet as the attendance and the Overtime sheet as the approved hours.
 * A sheet the file does not carry is absent from the payload, which is how the pipeline knows to
 * leave that half alone.
 *
 * The issued template for all three is one legal entity × one month: a person down the side and a
 * calendar day across the top. A long-form sheet still imports, including the files operators
 * already have on disk — except that a file still carrying the retired `overtime_in`/`overtime_out`
 * columns is refused by name rather than silently imported without its overtime.
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
	expandOvertimeMonthGrid,
	expandRosterMonthGrid,
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders,
	parseOvertimeHours,
	RETIRED_OVERTIME_COLUMNS
} from '../import-month-grid.js';
import { readWorkbookSettings, SETTINGS_SHEET_NAME } from '../../../lib/workbook-settings.js';

const ROSTER_SHEET_NAME = 'Roster';
const ATTENDANCE_SHEET_NAME = 'Time entries';
const OVERTIME_SHEET_NAME = 'Overtime';

export { ROSTER_SHEET_NAME, ATTENDANCE_SHEET_NAME, OVERTIME_SHEET_NAME };

/** `shift_code` is one of the entity's roster codes: a shift, REST or OFF. */
type RosterImportRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly shift_code: string;
};

type AttendanceImportRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly clock_in?: string | undefined;
	readonly clock_out?: string | undefined;
};

type OvertimeImportRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly overtime_hours: number;
};

/** The whole workbook. A sheet the file does not carry is absent; an empty sheet is `[]`. */
type SchedulingImportPayload = {
	readonly legal_entity: string;
	readonly month: string;
	readonly timezone?: string;
	readonly roster?: readonly RosterImportRow[];
	readonly attendance?: readonly AttendanceImportRow[];
	readonly overtime?: readonly OvertimeImportRow[];
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
 * A file that still carries the retired overtime-window columns is refused by name: overtime is
 * keyed now, and importing such a file as if it carried none would silently drop its overtime.
 */
function longFormAttendanceRows(table: SheetTable): readonly AttendanceImportRow[] {
	const retired = table.headers.filter((header) => RETIRED_OVERTIME_COLUMNS.includes(header));
	if (retired.length > 0)
		throw new WorkbookImportError(
			`The "${table.sheetName}" sheet still carries ${retired.join(', ')}.`,
			[
				`Overtime is no longer read from a clock window: key the approved hours on the "${OVERTIME_SHEET_NAME}" sheet.`
			]
		);
	return readRows(table, identifyPersonDay, (reader): AttendanceImportRow => ({
		employee_number: reader.requiredText('employee_number') ?? '',
		work_date: reader.calendarDate('work_date') ?? '',
		clock_in: reader.clockTime('clock_in'),
		clock_out: reader.clockTime('clock_out')
	}));
}

/** Blank overtime is no approval; a stated figure is kept, in the half-hour steps the write path enforces. */
function longFormOvertimeRows(table: SheetTable): readonly OvertimeImportRow[] {
	const parsed = readRows(table, identifyPersonDay, (reader) => {
		const employee_number = reader.requiredText('employee_number') ?? '';
		const work_date = reader.calendarDate('work_date') ?? '';
		const text = reader.text('overtime_hours');
		if (text == null) return { employee_number, work_date, overtime_hours: 0 };
		const value = Number(text);
		if (!Number.isFinite(value) || value < 0 || value > 24 || Math.round(value * 2) !== value * 2) {
			reader.reject('overtime_hours', 'a number of hours in half-hour steps between 0 and 24');
			return { employee_number, work_date, overtime_hours: 0 };
		}
		return { employee_number, work_date, overtime_hours: value };
	});
	return parsed.filter((row) => row.overtime_hours > 0);
}

/**
 * The person-days a scheduling file sets, each created or restated by the import. The pipeline
 * writes restated days itself (and, when a file both restates and creates, the new ones too), so
 * the host's count of returned rows is not the import's.
 */
export const schedulingImportDays = (payload: SchedulingImportPayload): number =>
	new Set(
		[...(payload.roster ?? []), ...(payload.attendance ?? []), ...(payload.overtime ?? [])].map(
			(row) => `${row.employee_number}\t${row.work_date}`
		)
	).size;

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
	const hasOvertime = grids.has(OVERTIME_SHEET_NAME);
	if (!hasRoster && !hasAttendance && !hasOvertime)
		throw new WorkbookImportError(
			`This file has none of the "${ROSTER_SHEET_NAME}", "${ATTENDANCE_SHEET_NAME}" or "${OVERTIME_SHEET_NAME}" sheets.`,
			['Start from the scheduling workbook template, which carries all three.']
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
	const overtime = hasOvertime
		? readSheet<OvertimeImportRow>(grids, OVERTIME_SHEET_NAME, {
				longFormColumns: ['employee_number', 'work_date', 'overtime_hours'],
				longForm: longFormOvertimeRows,
				monthGrid: expandOvertimeMonthGrid
			})
		: undefined;
	if (
		(roster?.length ?? 0) === 0 &&
		(attendance?.length ?? 0) === 0 &&
		(overtime?.length ?? 0) === 0
	)
		throw new WorkbookImportError('This file has nothing to import.', [
			'Fill the Roster sheet, the Time entries sheet, the Overtime sheet, or any of them.'
		]);
	return {
		legal_entity: settings.legal_entity,
		month: settings.month,
		...(settings.timezone == null || settings.timezone === ''
			? {}
			: { timezone: settings.timezone }),
		...(roster === undefined ? {} : { roster }),
		...(attendance === undefined ? {} : { attendance }),
		...(overtime === undefined ? {} : { overtime })
	};
}
