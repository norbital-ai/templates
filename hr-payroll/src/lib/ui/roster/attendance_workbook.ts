import { Option, Schema } from 'effect';
import { Workbook, type Cell } from 'exceljs';

/**
 * The attendance workbook: one row per employed person-day. The import writes the clock, the approved overtime and
 * the incentive hours through `roster_entry.create`; the template downloads the same columns, one blank row per
 * person and day of the period.
 */
export type AttendanceRow = {
	readonly employee_number: string;
	readonly work_date: string;
	readonly clock_in: string | null;
	readonly clock_out: string | null;
	readonly overtime_hours: number | null;
	readonly incentive_hours: number | null;
};

export const ATTENDANCE_HEADERS = [
	'Employee number',
	'Date (YYYY-MM-DD)',
	'Clock in (HH:MM)',
	'Clock out (HH:MM)',
	'Overtime hours',
	'Incentive hours'
] as const;

/** A cell as its text: dates stay ISO, links and formula results read as their text. */
const SheetScalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
const SheetLink = Schema.Struct({ text: Schema.String });
const SheetFormula = Schema.Struct({ result: SheetScalar });
const textOf = (cell: Cell): string => {
	const value: unknown = cell.value;
	if (Schema.is(Schema.String)(value)) return value.trim();
	if (Schema.is(Schema.Union([Schema.Number, Schema.Boolean]))(value)) return String(value);
	if (Schema.is(Schema.Date)(value)) return value.toISOString();
	if (Schema.is(SheetLink)(value)) return value.text.trim();
	if (Schema.is(SheetFormula)(value)) {
		const result = value.result;
		return Schema.is(Schema.String)(result) ? result.trim() : String(result);
	}
	return '';
};
const timeOf = (cell: Cell): string | null => {
	const text = textOf(cell);
	if (text === '') return null;
	const match = /^(\d{1,2}):(\d{2})/.exec(text);
	if (match != null) return `${match[1]!.padStart(2, '0')}:${match[2]}`;
	const stamp = new Date(text);
	return Number.isNaN(stamp.getTime())
		? null
		: `${String(stamp.getUTCHours()).padStart(2, '0')}:${String(stamp.getUTCMinutes()).padStart(2, '0')}`;
};
const hoursOf = (cell: Cell): number | null => {
	const text = textOf(cell);
	if (text === '') return null;
	const parsed = Schema.decodeUnknownOption(Schema.NumberFromString)(text);
	return Option.isSome(parsed) ? parsed.value : null;
};

/** The first sheet's rows, skipping the header and anything without an employee number and a calendar day. */
export async function parseAttendanceWorkbook(buffer: ArrayBuffer): Promise<AttendanceRow[]> {
	const workbook = new Workbook();
	await workbook.xlsx.load(buffer);
	const sheet = workbook.worksheets[0];
	if (sheet == null) return [];
	const rows: AttendanceRow[] = [];
	sheet.eachRow((row, index) => {
		if (index === 1) return;
		const employee_number = textOf(row.getCell(1));
		const work_date = textOf(row.getCell(2)).slice(0, 10);
		if (employee_number === '' || !/^\d{4}-\d{2}-\d{2}$/.test(work_date)) return;
		rows.push({
			employee_number,
			work_date,
			clock_in: timeOf(row.getCell(3)),
			clock_out: timeOf(row.getCell(4)),
			overtime_hours: hoursOf(row.getCell(5)),
			incentive_hours: hoursOf(row.getCell(6))
		});
	});
	return rows;
}

/** One blank workbook for the period: each employed person against each of its days. */
export async function downloadAttendanceTemplate(options: {
	readonly people: readonly { readonly employee_number: string; readonly name: string }[];
	readonly days: readonly string[];
}): Promise<void> {
	const workbook = new Workbook();
	const sheet = workbook.addWorksheet('Attendance');
	sheet.addRow([...ATTENDANCE_HEADERS, 'Name']);
	sheet.getRow(1).font = { bold: true };
	for (const person of options.people)
		for (const day of options.days)
			sheet.addRow([person.employee_number, day, '', '', '', '', person.name]);
	const buffer = await workbook.xlsx.writeBuffer();
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = 'attendance.xlsx';
	anchor.click();
	URL.revokeObjectURL(url);
}
