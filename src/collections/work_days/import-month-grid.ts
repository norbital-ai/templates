/**
 * The issued import templates are one legal entity × one month: a person down the side and a
 * calendar day across the top. The import pipeline still consumes one row per person-day, so this
 * expands the grid before anything is posted.
 *
 * Both sheets of the workbook are expanded here, and always were: the roster sheet's cells are
 * roster-code tokens and the attendance sheet's are clock ranges, but the header row, the day
 * columns and the refuse-the-whole-file rule are one piece of grammar. That is why the roster
 * importer reached across a collection boundary for `expandRosterMonthGrid` while the two halves
 * lived in separate collections; a person-day is one row now, so the reach is gone.
 *
 * Long-form sheets (`employee_number`, `work_date`, …) keep importing unchanged.
 */

import { isCalendarDate, isClockTime } from '@norbital-ai/std/date';
import { getErrorMessage } from '@norbital-ai/std/error';
import { decodeNumber } from '@norbital-ai/std/json';

import { Result, Schema } from 'effect';
import { calendarDaysInMonth, monthBounds } from '../../lib/period.js';
import { WorkbookImportError, type SheetCell, type SheetTable } from '../../lib/workbook-rows.js';

const LONG_FORM_COLUMNS = new Set([
	'employee_number',
	'work_date',
	'shift_code',
	'assignment_code',
	'note',
	'day_type',
	'clock_in',
	'clock_out',
	'break_minutes',
	'reason',
	'overtime_in',
	'overtime_out',
	'overtime_authorized',
	'state'
]);

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
			`Column "${header}" is not a day of ${month}. Use 1–${calendarDaysInMonth(month).length}, or full YYYY-MM-DD dates.`
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

const expandedRosterCellSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	shift_code: Schema.String
});
type ExpandedRosterCell = Schema.Schema.Type<typeof expandedRosterCellSchema>;

const expandedTimeCellSchema = Schema.Struct({
	employee_number: Schema.String,
	work_date: Schema.String,
	clock_in: Schema.String,
	clock_out: Schema.optional(Schema.String)
});
type ExpandedTimeCell = Schema.Schema.Type<typeof expandedTimeCellSchema>;

const RANGE_SPLIT = /\s*[-–—/]\s*/;

function cellAsClockText(raw: SheetCell): string {
	if (raw == null) return '';
	if (raw instanceof Date) return `${pad(raw.getUTCHours())}:${pad(raw.getUTCMinutes())}`;
	if (typeof raw === 'number' && raw >= 0 && raw < 1) {
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
			const text = cellAsClockText(row.cells.get(column.header) ?? null);
			if (text === '') continue;
			const identity = `Row ${row.rowNumber} (${employee} on ${column.work_date})`;
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
	if (problems.length > 0) {
		throw new WorkbookImportError(
			`The "${table.sheetName}" sheet cannot be imported as it stands. Nothing was written — ` +
				'the whole file is refused so it can be corrected and re-imported as one:',
			problems
		);
	}
	return rows;
}
