/**
 * The browser half of the `work_days` import: one legal entity × one month, a person down the side
 * and a day across the top. One payload from the Settings sheet (entity, month, timezone) and the
 * Roster, Time entries and Overtime sheets; a sheet the file lacks leaves that half alone. Long-form
 * sheets still import; retired `overtime_in`/`overtime_out` columns are refused by name.
 */

import {
	identifyRowByColumns,
	readRows,
	readSheetTable,
	WorkbookImportError,
	type RowReader,
	type SheetTable,
	type WorkbookGrids
} from '../../../../lib/workbook-rows.js';
import {
	expandOvertimeMonthGrid,
	expandRosterMonthGrid,
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders,
	parseOvertimeHours,
	RETIRED_OVERTIME_COLUMNS
} from './import-month-grid.js';
import { readWorkbookSettings, SETTINGS_SHEET_NAME } from '../../../../lib/workbook-settings.js';
import { decodeNumber } from '../../../../lib/wire.js';

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
	readonly clock_in: string;
	readonly clock_out?: string;
};

type OvertimeImportRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly overtime_hours: number;
	readonly overtime_consented_at?: string;
	/** The declared work-day inputs the sheet carries, one column each (`work_day_facts[].import`). */
	readonly facts?: Readonly<Record<string, string>>;
};

const LONG_FORM_OVERTIME_COLUMNS = [
	'employee_number',
	'work_date',
	'overtime_hours',
	'overtime_consented_at'
];

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
 * An empty clock cell reads as absent, not as a value: a row with neither punch states no attendance and is not sent,
 * and a close without an arrival is refused by name (the action takes an arrival on every row). The pipeline derives
 * whether the final interval is open from whether a close arrived.
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
	return readRows(table, identifyPersonDay, (reader) => {
		const employee_number = reader.requiredText('employee_number') ?? '';
		const work_date = reader.calendarDate('work_date') ?? '';
		const clock_in = reader.clockTime('clock_in');
		const clock_out = reader.clockTime('clock_out');
		// a bad clock_in was already rejected by clockTime; only a blank one is rejected here, so each problem is named once
		if (reader.text('clock_in') == null && clock_out != null)
			reader.reject('clock_in', 'a local time as HH:mm');
		return clock_in == null
			? null
			: { employee_number, work_date, clock_in, ...(clock_out == null ? {} : { clock_out }) };
	}).filter((row) => row != null);
}

/** Blank overtime is no approval; a stated figure is kept, in the half-hour steps the write path enforces. */
function longFormOvertimeRows(table: SheetTable): readonly OvertimeImportRow[] {
	const evidence = (reader: RowReader, field: string) => {
		const value = reader.text(field);
		if (value == null) return undefined;
		if (
			!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
			!Number.isFinite(Date.parse(value))
		) {
			reader.reject(field, 'an ISO instant with a timezone, e.g. 2026-01-05T08:00:00+07:00');
			return undefined;
		}
		return new Date(value).toISOString();
	};
	// Every other column is a declared work-day input; one holding a date-time is an instant.
	const factColumns = table.headers.filter(
		(header) => header.trim() !== '' && !LONG_FORM_OVERTIME_COLUMNS.includes(header)
	);
	const parsed = readRows(table, identifyPersonDay, (reader) => {
		const employee_number = reader.requiredText('employee_number') ?? '';
		const work_date = reader.calendarDate('work_date') ?? '';
		const text = reader.text('overtime_hours');
		const overtime_consented_at = evidence(reader, 'overtime_consented_at');
		const inputs = Object.fromEntries(
			factColumns.flatMap((column) => {
				const value = reader.text(column);
				if (value == null) return [];
				const instant = /^\d{4}-\d{2}-\d{2}T/.test(value) ? evidence(reader, column) : value;
				return instant == null ? [] : [[column, instant] as const];
			})
		);
		const facts = {
			...(overtime_consented_at == null ? {} : { overtime_consented_at }),
			...(Object.keys(inputs).length === 0 ? {} : { facts: inputs })
		};
		if (text == null) return { employee_number, work_date, overtime_hours: 0, ...facts };
		const value = decodeNumber(text);
		if (!Number.isFinite(value) || value < 0 || value > 24 || Math.round(value * 2) !== value * 2) {
			reader.reject('overtime_hours', 'a number of hours in half-hour steps between 0 and 24');
			return { employee_number, work_date, overtime_hours: 0, ...facts };
		}
		return { employee_number, work_date, overtime_hours: value, ...facts };
	});
	return parsed.filter((row) => row.overtime_hours > 0 || row.facts != null);
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
 * The rows a scheduling file records work on — a punch, or planned extra hours — that fall on a
 * company holiday the person observes (`observed`, payroll's own calendar) while the overtime rule
 * does not cover them (`entitled`): no overtime is paid for them, so HR grants an off-in-lieu day.
 * The import writes them; this is the warning, never a refusal.
 */
export function holidayWorkedRows(
	payload: SchedulingImportPayload,
	observed: (employeeNumber: string) => ReadonlySet<string>,
	entitled: (employeeNumber: string, date: string) => boolean
): readonly { readonly employee_number: string; readonly work_date: string }[] {
	const worked = new Map<string, { employee_number: string; work_date: string }>();
	for (const row of [
		...(payload.attendance ?? []),
		...(payload.overtime ?? []).filter((row) => row.overtime_hours > 0)
	])
		worked.set(`${row.employee_number}\t${row.work_date}`, {
			employee_number: row.employee_number,
			work_date: row.work_date
		});
	return [...worked.values()]
		.filter(
			(row) =>
				observed(row.employee_number).has(row.work_date) &&
				!entitled(row.employee_number, row.work_date)
		)
		.toSorted(
			(left, right) =>
				left.employee_number.localeCompare(right.employee_number) ||
				left.work_date.localeCompare(right.work_date)
		);
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
