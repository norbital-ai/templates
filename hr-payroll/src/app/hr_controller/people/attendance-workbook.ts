/** Input-only workbook grammar lives with its attendance page; calculations remain in runtime configuration. */
import {parseDateTime,toZoned} from '@internationalized/date';
import { PlainDate, addDays, days, monthOf } from '@norbital-ai/std/date';
import { Result } from 'effect';
import * as Predicate from 'effect/Predicate';
import { isCalendarDate, isClockTime } from '../../../lib/payroll_engine/foundation/time.js';
import { decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';
import { getErrorMessage } from '../../../lib/payroll_engine/foundation/primitives.js';
import { isYearMonth } from '../../../lib/payroll_engine/foundation/time.js';
import { findSheet, identifyRowByColumns, readRows, readSheetTable, WorkbookImportError, type RowReader, type SheetCell, type SheetTable, type WorkbookGrids } from '../../../lib/payroll_engine/foundation/workbook-rows.js';
const monthBounds = (month: string) => { const bounds = monthOf(PlainDate(`${month}-01`)); return { start: bounds.from, end: bounds.to! }; };
/**
 * The `Settings` sheet every issued import workbook carries: one legal entity, one month,
 * and — for attendance — the IANA timezone its clock cells are local to.
 *
 * Keys are matched after the same normalisation the column headers use, so `Legal entity`
 * and `legal_entity` are the same row.
 */


export const SETTINGS_SHEET_NAME = 'Settings';

type WorkbookSettings = {
	readonly legal_entity?: string | undefined;
	readonly month?: string | undefined;
	readonly timezone?: string | undefined;
};

function settingKey(cell: SheetCell): string {
	return String(cell ?? '')
		.trim()
		.toLowerCase()
		.replaceAll(/[\s-]+/g, '_');
}

function settingValue(cell: SheetCell): string | undefined {
	if (cell == null) return undefined;
	const text = String(cell).trim();
	return text === '' ? undefined : text;
}

/** Every spelling the sheet accepts, against the setting it names. */
const SETTING_FIELDS = new Map<string, keyof WorkbookSettings>([
	['legal_entity', 'legal_entity'],
	['company', 'legal_entity'],
	['entity', 'legal_entity'],
	['company_name', 'legal_entity'],
	['month', 'month'],
	['roster_month', 'month'],
	['period', 'month'],
	['timezone', 'timezone'],
	['time_zone', 'timezone']
]);

/** Reads the Settings sheet when present. Missing keys stay absent rather than guessed. */
export function readWorkbookSettings(grids: WorkbookGrids): WorkbookSettings {
	const sheet = findSheet(grids, SETTINGS_SHEET_NAME);
	if (sheet == null) return {};

	const read: { -readonly [K in keyof WorkbookSettings]: string } = {};
	for (const cells of sheet) {
		const field = SETTING_FIELDS.get(settingKey(cells[0] ?? null));
		const value = settingValue(cells[1] ?? null);
		if (field == null || value == null) continue;
		read[field] = value;
	}
	const { legal_entity, month, timezone } = read;

	if (month != null && !isYearMonth(month)) {
		throw new WorkbookImportError(
			`The Settings sheet's month is "${month}", which is not a payroll month (YYYY-MM).`
		);
	}

	return { legal_entity, month, timezone };
}

/**
 * The issued import templates are one legal entity × one month: a person down the side and a
 * calendar day across the top. The import pipeline still consumes one row per person-day, so this
 * expands the grid before anything is posted.
 *
 * Every sheet of the workbook is expanded here: the roster sheet's cells are roster-code tokens,
 * the attendance sheet's are clock ranges (several to a cell, `;`- or line-separated, are one row
 * each: the day's intervals) and the overtime sheet's are approved hours, but the
 * header row, the day columns and the refuse-the-whole-file rule are one piece of grammar.
 *
 * Long-form sheets (`employee_number`, `work_date`, …) keep importing unchanged.
 */



const LONG_FORM_COLUMNS = new Set([
	'employee_number',
	'work_date',
	'shift_code',
	'day_type',
	'clock_in',
	'clock_out',
	'reason',
	'overtime_hours',
	'state'
]);

/** The long-form columns the importer used to read an overtime window from, now refused by name. */
export const RETIRED_OVERTIME_COLUMNS = ['overtime_in', 'overtime_out', 'overtime_authorized'];

const DAY_NUMBER = /^(0?[1-9]|[12]\d|3[01])$/;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** A header that names a day of the Settings month, or an explicit `YYYY-MM-DD` column. */
function monthGridDateForHeader(header: string, month: string): string | undefined {
	if (header === '' || LONG_FORM_COLUMNS.has(header)) return undefined;
	if (isCalendarDate(header)) {
		const bounds = monthBounds(month);
		if (header < bounds.start || header > bounds.end) {
			throw new WorkbookImportError(
				`Column "${header}" is not a day of ${month}. Every day column must fall inside the Settings month.`
			);
		}
		return header;
	}
	if (!DAY_NUMBER.test(header)) return undefined;
	const day = `${month}-${pad(decodeNumber(header))}`;
	if (!isCalendarDate(day)) {
		throw new WorkbookImportError(
			`Column "${header}" is not a day of ${month}. Use 1–${days(monthOf(`${month}-01`))}, or full YYYY-MM-DD dates.`
		);
	}
	return day;
}

function monthGridDateColumns(
	headers: readonly string[],
	month: string
): readonly { readonly header: string; readonly work_date: string }[] {
	const columns: { header: string; work_date: string }[] = [];
	const seen = new Set<string>();
	for (const header of headers) {
		const work_date = monthGridDateForHeader(header, month);
		if (work_date == null) continue;
		if (seen.has(work_date)) {
			throw new WorkbookImportError(`The sheet repeats ${work_date} as a column.`);
		}
		seen.add(work_date);
		columns.push({ header, work_date });
	}
	if (columns.length === 0) {
		throw new WorkbookImportError(
			'This sheet has no day columns to import. Use day numbers 1–31 or YYYY-MM-DD headers, as the import template does.'
		);
	}
	return columns;
}

export function isLongFormImportHeaders(headers: readonly string[]): boolean {
	return headers.includes('employee_number') && headers.includes('work_date');
}

export function isMonthGridImportHeaders(headers: readonly string[]): boolean {
	return (
		headers.includes('employee_number') &&
		!headers.includes('work_date') &&
		headers.some((header) => DAY_NUMBER.test(header) || isCalendarDate(header))
	);
}

function requireMonth(month: string | undefined): string {
	if (month == null) {
		throw new WorkbookImportError(
			'This month grid needs a Settings sheet with a "month" row (YYYY-MM), as the import template has.'
		);
	}
	return month;
}

type ExpandedRosterCell = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly shift_code: string;
};

type ExpandedTimeCell = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly clock_in: string;
	readonly clock_out?: string;
};

type ExpandedOvertimeCell = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly overtime_hours: number;
};

const RANGE_SPLIT = /\s*[-–—/]\s*/;
const INTERVAL_SPLIT = /[;\n]/;

function cellAsClockText(raw: SheetCell): string {
	if (raw == null) return '';
	if (raw instanceof Date) return `${pad(raw.getUTCHours())}:${pad(raw.getUTCMinutes())}`;
	if (Predicate.isNumber(raw) && raw >= 0 && raw < 1) {
		const minutes = Math.round(raw * 1_440);
		return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
	}
	return String(raw).trim();
}

/** `08:16-17:10` is a closed day; `20:31` is still open; blank is no punch. */
function parseClockRange(
	value: string,
	identity: string
): { clock_in: string; clock_out?: string } {
	const parts = value
		.split(RANGE_SPLIT)
		.map((part) => part.trim())
		.filter((part) => part !== '');
	const expected = `${identity}: "${value}" is not a local clock range. Use HH:mm-HH:mm, or HH:mm when still open.`;
	if (parts.length === 0 || parts.length > 2) throw new WorkbookImportError(expected);
	const padded = parts.map((part) => (/^\d:\d{2}$/.test(part) ? `0${part}` : part));
	const truncated = padded.map((part) =>
		/^\d{2}:\d{2}:\d{2}$/.test(part) ? part.slice(0, 5) : part
	);
	if (truncated.some((part) => !isClockTime(part))) throw new WorkbookImportError(expected);
	const clock_in = truncated[0]!;
	const clock_out = truncated[1];
	return clock_out == null ? { clock_in } : { clock_in, clock_out };
}

export function expandRosterMonthGrid(
	table: SheetTable,
	month: string | undefined
): readonly ExpandedRosterCell[] {
	const resolvedMonth = requireMonth(month);
	const columns = monthGridDateColumns(table.headers, resolvedMonth);
	const problems: string[] = [];
	const rows: ExpandedRosterCell[] = [];
	for (const row of table.rows) {
		const employee = String(row.cells.get('employee_number') ?? '').trim();
		if (employee === '') {
			problems.push(`Row ${row.rowNumber}: employee_number is empty.`);
			continue;
		}
		for (const column of columns) {
			const raw = row.cells.get(column.header);
			const shift = raw == null ? '' : String(raw).trim();
			if (shift === '') continue;
			rows.push({
				employee_number: employee,
				work_date: column.work_date,
				shift_code: shift
			});
		}
	}
	if (problems.length > 0) {
		throw new WorkbookImportError(
			`The "${table.sheetName}" sheet cannot be imported as it stands. Nothing was written — ` +
				'the whole file is refused so it can be corrected and re-imported as one:',
			problems
		);
	}
	return rows;
}

/**
 * `3` or `2.5` is approved hours; blank is no approval. A day cannot hold more hours than it has, so
 * that bound is enforced here, where the message can name the row and the day the operator must fix.
 * The keying step is the governing version's (`work_rules.overtime_unit_hours`), judged at the write.
 */
export function parseOvertimeHours(raw: SheetCell, identity: string): number | undefined {
	if (raw == null) return undefined;
	const text = Predicate.isNumber(raw) ? String(raw) : String(raw).trim();
	if (text === '') return undefined;
	const value = decodeNumber(text);
	if (!Number.isFinite(value))
		throw new WorkbookImportError(
			`${identity}: "${text}" is not a number of hours. Enter hours as a number.`
		);
	if (value < 0)
		throw new WorkbookImportError(`${identity}: approved overtime cannot be negative.`);
	if (value > 24)
		throw new WorkbookImportError(
			`${identity}: approved overtime cannot exceed the 24 hours a day has.`
		);
	return value;
}

export function expandOvertimeMonthGrid(
	table: SheetTable,
	month: string | undefined
): readonly ExpandedOvertimeCell[] {
	const resolvedMonth = requireMonth(month);
	const columns = monthGridDateColumns(table.headers, resolvedMonth);
	const problems: string[] = [];
	const rows: ExpandedOvertimeCell[] = [];
	for (const row of table.rows) {
		const employee = String(row.cells.get('employee_number') ?? '').trim();
		if (employee === '') {
			problems.push(`Row ${row.rowNumber}: employee_number is empty.`);
			continue;
		}
		for (const column of columns) {
			const identity = `Row ${row.rowNumber} (${employee} on ${column.work_date})`;
			const parsed = Result.try({
				try: () => parseOvertimeHours(row.cells.get(column.header) ?? null, identity),
				catch: (error) => error
			});
			if (Result.isFailure(parsed)) {
				problems.push(getErrorMessage(parsed.failure));
				continue;
			}
			if (parsed.success === undefined) continue;
			rows.push({
				employee_number: employee,
				work_date: column.work_date,
				overtime_hours: parsed.success
			});
		}
	}
	if (problems.length > 0) {
		throw new WorkbookImportError(
			`The "${table.sheetName}" sheet cannot be imported as it stands. Nothing was written — ` +
				'the whole file is refused so it can be corrected and re-imported as one:',
			problems
		);
	}
	return rows;
}

export function expandTimeMonthGrid(
	table: SheetTable,
	month: string | undefined
): readonly ExpandedTimeCell[] {
	const resolvedMonth = requireMonth(month);
	const columns = monthGridDateColumns(table.headers, resolvedMonth);
	const problems: string[] = [];
	const rows: ExpandedTimeCell[] = [];
	for (const row of table.rows) {
		const employee = String(row.cells.get('employee_number') ?? '').trim();
		if (employee === '') {
			problems.push(`Row ${row.rowNumber}: employee_number is empty.`);
			continue;
		}
		for (const column of columns) {
			const identity = `Row ${row.rowNumber} (${employee} on ${column.work_date})`;
			// One interval per `;` or line in the cell, each its own row, in the order written: a split shift.
			for (const text of cellAsClockText(row.cells.get(column.header) ?? null)
				.split(INTERVAL_SPLIT)
				.map((part) => part.trim())
				.filter((part) => part !== '')) {
				const parsed = Result.try({
					try: () => ({
						employee_number: employee,
						work_date: column.work_date,
						...parseClockRange(text, identity)
					}),
					catch: (error) => error
				});
				if (Result.isSuccess(parsed)) {
					rows.push(parsed.success);
				} else {
					problems.push(getErrorMessage(parsed.failure));
				}
			}
		}
	}
	if (problems.length > 0) {
		throw new WorkbookImportError(
			`The "${table.sheetName}" sheet cannot be imported as it stands. Nothing was written — ` +
				'the whole file is refused so it can be corrected and re-imported as one:',
			problems
		);
	}
	return rows;
}

/**
 * The browser half of the `roster_entries` import: one legal entity × one month, a person down the side
 * and a day across the top. One payload from the Settings sheet (entity, month, timezone) and the
 * Roster, Time entries and Overtime sheets; a sheet the file lacks leaves that half alone. Long-form
 * sheets still import; retired `overtime_in`/`overtime_out` columns are refused by name.
 */


const ROSTER_SHEET_NAME = 'Roster';
const ATTENDANCE_SHEET_NAME = 'Time entries';
const OVERTIME_SHEET_NAME = 'Overtime';
export const PIECE_SHEET_NAME = 'Piecework';

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
	readonly pieces?: readonly PieceImportRow[];
};

type PieceImportRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly piece_units: number;
	readonly piece_unit_rate: number;
	readonly piece_overtime_units?: number;
};
function pieceRows(table: SheetTable): readonly PieceImportRow[] {
	return readRows(table, identifyPersonDay, (reader) => {
		const number = (field: string) => {
			const text = reader.text(field);
			if (text == null) return undefined;
			const value = decodeNumber(text);
			if (!Number.isFinite(value) || value < 0) {
				reader.reject(field, 'a non-negative number');
				return undefined;
			}
			return value;
		};
		const units = number('piece_units'),
			rate = number('piece_unit_rate'),
			overtime = number('piece_overtime_units');
		if (units == null && rate == null && overtime == null) return null;
		if (units == null || rate == null || (overtime != null && overtime > units))
			reader.reject(
				'piece_units',
				'total units and rate, with overtime units no greater than total'
			);
		return {
			employee_number: reader.requiredText('employee_number') ?? '',
			work_date: reader.calendarDate('work_date') ?? '',
			piece_units: units ?? 0,
			piece_unit_rate: rate ?? 0,
			...(overtime == null ? {} : { piece_overtime_units: overtime })
		};
	}).filter((row) => row != null);
}
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
	const table = readSheetTable(grids, sheetName, ['employee_number'], { allowEmptyRows: true });
	if (isLongFormImportHeaders(table.headers)) {
		return options.longForm(
			readSheetTable(grids, sheetName, options.longFormColumns, { allowEmptyRows: true })
		);
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

/** Blank overtime is no approval; a stated figure is kept, on the keying step the write path enforces. */
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
		if (!Number.isFinite(value) || value < 0 || value > 24) {
			reader.reject('overtime_hours', 'a number of hours between 0 and 24');
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
		[
			...(payload.roster ?? []),
			...(payload.attendance ?? []),
			...(payload.overtime ?? []),
			...(payload.pieces ?? [])
		].map((row) => `${row.employee_number}\t${row.work_date}`)
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
	const hasPieces = grids.has(PIECE_SHEET_NAME);
	if (!hasRoster && !hasAttendance && !hasOvertime && !hasPieces)
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
	const pieces = hasPieces
		? pieceRows(
				readSheetTable(
					grids,
					PIECE_SHEET_NAME,
					[
						'employee_number',
						'work_date',
						'piece_units',
						'piece_unit_rate',
						'piece_overtime_units'
					],
					{ allowEmptyRows: true }
				)
			)
		: undefined;
	return {
		...(pieces === undefined ? {} : { pieces }),
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

/** Convert ordered workbook clock cells to native instants; later intervals retain their overnight day. */
export function attendanceImportRows(rows:readonly AttendanceImportRow[],timezone:string){
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new WorkbookImportError('Attendance requires an actual IANA timezone.');}
 const result=new Map<string,{employee_number:string;work_date:ReturnType<typeof PlainDate>;worked_intervals:{start:string;end:string|null}[]}>();
 const instant=(date:string,clock:string)=>{
  if(!isCalendarDate(date)||!isClockTime(clock))throw new WorkbookImportError('Attendance clock fields require a calendar date and HH:mm local time.');
  try{return toZoned(parseDateTime(`${date}T${clock}`),timezone,'reject').toDate().toISOString();}
  catch{throw new WorkbookImportError(`The local clock ${date} ${clock} is not an unambiguous time in ${timezone}.`);}
 };
 for(const row of rows){
  const date=PlainDate(row.work_date),key=`${row.employee_number}:${date}`;
  const grouped=result.get(key)??{employee_number:row.employee_number,work_date:date,worked_intervals:[]};
  const previous=grouped.worked_intervals.at(-1);
  if(previous?.end===null)throw new WorkbookImportError('Only the last attendance interval may remain open.');
  let opened=date,start=instant(opened,row.clock_in);
  if(previous?.end!=null&&Date.parse(start)<Date.parse(previous.end)){opened=addDays(opened,1);start=instant(opened,row.clock_in);}
  const close=row.clock_out;
  const end=close==null?null:instant(close<=row.clock_in?addDays(opened,1):opened,close);
  if(previous?.end!=null&&Date.parse(start)<Date.parse(previous.end))throw new WorkbookImportError('Attendance intervals must remain ordered and non-overlapping.');
  grouped.worked_intervals.push({start,end});result.set(key,grouped);
 }
 return [...result.values()];
}

/** Bind workbook input to the user's actual selected employer and sealed native action configuration. */
export function attendanceWorkbookRequest(payload:SchedulingImportPayload,source:{entity_id:string;entity_name:string;snapshot_id:string;configuration_hash:string;timezone:string}){
 if(payload.legal_entity.trim()!==source.entity_name)throw new WorkbookImportError('The workbook must name the actual selected legal entity.');
 if(payload.attendance!=null&&payload.timezone==null)throw new WorkbookImportError('Attendance must declare its actual timezone on the Settings sheet.');
 if(payload.roster==null&&payload.attendance==null&&payload.pieces==null&&payload.overtime==null)throw new WorkbookImportError('The file has none of the Roster, Time entries, Piecework or Overtime sheets.');
 return {entity_id:source.entity_id,snapshot_id:source.snapshot_id,configuration_hash:source.configuration_hash,month:payload.month,
  ...(payload.attendance==null?{}:{rows:attendanceImportRows(payload.attendance,payload.timezone!)}),
  ...(payload.roster==null?{}:{roster:payload.roster.map(row=>({...row,work_date:PlainDate(row.work_date)}))}),
  ...(payload.pieces==null?{}:{pieces:payload.pieces.map(row=>({...row,work_date:PlainDate(row.work_date)}))}),
  ...(payload.overtime==null?{}:{overtime:payload.overtime.map(row=>({...row,work_date:PlainDate(row.work_date)}))})
 };
}
