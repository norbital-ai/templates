/**
 * The two import templates operators are issued, written to `~/Desktop` (or the directory named by
 * `IMPORT_TEMPLATE_DIR`): the scheduling workbook (Roster, Time entries and Overtime sheets) and
 * the holidays workbook.
 *
 * The sheets mirror exactly what the reader in `src/collections/work_days/lib` accepts as the
 * designed layout — one entity × one month. The Roster sheet is the plan as a month grid: a person
 * down the side and a calendar day across the top, cells carrying a company roster code (or the
 * reserved `PH` token). The Time entries sheet is the attendance as one person-day per row, with a
 * `clock_in` and a `clock_out` column, each a local wall time `HH:mm`; a blank `clock_out` is still
 * open. Blank cells are omitted — they are not inferred rest days and not punchless leave. The two
 * clock columns are imported as the one timestamp interval the day worked. The timezone, legal
 * entity and month are declared once on the `Settings` sheet. The Overtime sheet is the approved
 * overtime as a month grid, each cell a number of hours in half-hour steps; a blank cell is no
 * approval.
 *
 * A long-form Roster sheet (`employee_number`, `work_date`, `shift_code`) and a month-grid Time
 * entries sheet (`HH:mm-HH:mm` per day cell) still import, including the files operators already
 * have on disk — but the issued template is the grid roster and the two-column clock table. The
 * `Read me first` sheets state the rules in the same terms the readers enforce them, so what the
 * file promises and what the import accepts cannot drift apart quietly.
 *
 * The script is re-runnable and deterministic: the workbook metadata is pinned to a fixed instant,
 * so two runs emit the same bytes, and it reads each file back on the way out and asserts the
 * header row and Settings keys it shipped.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Effect } from 'effect';
import ExcelJS from 'exceljs';

/** Fixed so a re-run emits the same bytes. The value itself is arbitrary; its fixedness is not. */
const EPOCH = new Date('2026-08-04T16:00:00.000Z');

/*
 * ExcelJS packs the workbook through JSZip, and JSZip stamps every entry with the instant it was
 * added — two runs a second apart would otherwise emit different bytes for the same sheets. The
 * zip library is ExcelJS's own dependency rather than this workspace's, so it is reached through
 * ExcelJS's resolution, and its default entry date is pinned to the same instant as the metadata.
 */
createRequire(createRequire(import.meta.url).resolve('exceljs'))('jszip').defaults.date = EPOCH;

const TEMPLATE_DIR = process.env.IMPORT_TEMPLATE_DIR || path.join(os.homedir(), 'Desktop');
const HOLIDAYS_TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'norbital-holidays-import-template.xlsx');
const HOLIDAY_HEADERS = ['date', 'name', 'replaces'];
const HOLIDAY_SAMPLE_ROWS = [
	['2027-01-01', "New Year's Day", ''],
	['2027-02-01', 'Federal Territory Day', ''],
	['2027-05-03', 'Labour Day (in lieu)', '2027-05-01']
];
const HOLIDAY_README = [
	'One sheet per entity, each sheet named for the entity as on file. Columns: date, name, replaces.',
	'date is the day observed, as YYYY-MM-DD.',
	'replaces is optional: the statutory date when the observance moved, e.g. a Sunday holiday taken on Monday.',
	'Add one sheet per entity and import the whole workbook once from the Entities page. One entity sheet on its own also imports from that entity’s Holidays tab, whatever the sheet is called.',
	'A day the entity already has is skipped, never duplicated or overwritten. Imported holidays arrive unpublished;',
	'publish each one on the entity’s Holidays tab. Only published holidays are used by rosters, leave and payroll.'
];
const SCHEDULING_TEMPLATE_PATH = path.join(
	TEMPLATE_DIR,
	'norbital-scheduling-import-template.xlsx'
);

const SAMPLE_MONTH = '2026-05';
const SAMPLE_LEGAL_ENTITY = 'Public Fixture Co';
const SAMPLE_TIMEZONE = 'Asia/Kuala_Lumpur';

function daysInMonth(month) {
	const [year, index] = month.split('-').map(Number);
	return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

function dayHeaders(month) {
	return Array.from({ length: daysInMonth(month) }, (_, index) => String(index + 1));
}

function gridRow(employee, assignments, month) {
	const cells = Array.from({ length: daysInMonth(month) }, () => '');
	for (const [day, value] of Object.entries(assignments)) cells[Number(day) - 1] = value;
	return [employee, ...cells];
}

const DAY_HEADERS = dayHeaders(SAMPLE_MONTH);
const GRID_HEADERS = ['employee_number', ...DAY_HEADERS];

const ROSTER_SAMPLE_ROWS = [
	gridRow('PUBEM0002', { 1: '7.5AM', 2: '7.5AM', 3: 'REST', 4: '7.5AM', 5: '7.5AM' }, SAMPLE_MONTH),
	gridRow('PUBEM0023', { 4: 'AM0830', 5: 'PM2030', 6: 'OFF' }, SAMPLE_MONTH)
];

const OVERTIME_SAMPLE_ROWS = [
	gridRow('PUBEM0002', { 4: 2, 5: 1.5 }, SAMPLE_MONTH),
	gridRow('PUBEM0023', { 4: 0.5 }, SAMPLE_MONTH)
];

const TIME_ENTRY_HEADERS = ['employee_number', 'work_date', 'clock_in', 'clock_out'];
const TIME_ENTRY_SAMPLE_ROWS = [
	['PUBEM0002', '2026-05-04', '08:16', '17:10'],
	['PUBEM0002', '2026-05-05', '08:02', '17:05'],
	['PUBEM0023', '2026-05-04', '20:30', '05:15'],
	['PUBEM0023', '2026-05-05', '20:28', '05:02'],
	['PUBEM0023', '2026-05-06', '20:31', '']
];

const SETTINGS_ROWS = [
	['Setting', 'Value'],
	['legal_entity', SAMPLE_LEGAL_ENTITY],
	['month', SAMPLE_MONTH],
	['timezone', SAMPLE_TIMEZONE],
	[],
	['', 'The employing legal entity as named on file, or its registration number.'],
	['', 'A payroll month as YYYY-MM. Day columns 1–31 are days of this month.'],
	['', 'An IANA timezone name. Asia/Kuala_Lumpur, Asia/Manila, Asia/Jakarta, Asia/Singapore.']
];

const SCHEDULING_README = [
	'Scheduling import — one legal entity, one month, three sheets',
	'',
	'"Roster" is the planned assignment: who is scheduled where, one person per row and one',
	'calendar day per column. "Time entries" is what actually happened on the clock, one person-day',
	'per row with a clock_in and a clock_out column. "Overtime" is the approved overtime, one person',
	'per row and one calendar day per column, each cell the hours approved. Do not rename the sheets',
	'or the column headers. Set legal_entity, month and timezone once, on the "Settings" sheet.',
	'',
	'The file is the state of the month it names, for every employee of the entity. Import it again',
	'and the month becomes what the file now says; a person the file no longer names loses the month',
	'and falls back to their work pattern. A file carrying only some of the sheets replaces only',
	'those halves. Every person on the Roster sheet needs a code on every day they are employed —',
	'write REST or OFF where they are not working — or the file is refused naming the missing days.',
	'A day a payslip has already taken into account may be restated as it is; a file that changes or',
	'omits one is refused naming those days.',
	'',
	'Roster — three rules that change what people get paid',
	'',
	'• A filled cell is an explicit assignment to that roster code on that day. A blank cell is an',
	'  absent assignment — it is not inferred as a rest day. REST and OFF must be written when they',
	'  are meant.',
	'',
	'• A cell must name an existing roster code. The hours a working day earns are measured against',
	'  the code it names, so a code the company has not defined refuses the file.',
	'',
	'• PH is not a roster code. Holidays are overlaid from the legal entity’s published calendar;',
	'  the cell names the shift the person would have worked, or REST or OFF.',
	'',
	'Time entries — three rules worth knowing',
	'',
	'• Each row is one person-day. clock_in and clock_out are local wall times as HH:mm, 24-hour. A',
	'  row with a clock_in and a blank clock_out is still open; an overnight shift needs no special',
	'  marker — a clock_out at or before clock_in is treated as the next calendar day. Every clock',
	'  time is local wall time in the Settings timezone.',
	'',
	'• The two clock columns carry punches only — breaks and the open/closed state are derived from',
	'  them. The break is the shift’s granted break, less any gap already visible between the punches.',
	'',
	'• A leave day is NOT a time entry. Leave lives in its own record so it can be approved and audited;',
	'  do not add punchless cells to stand in for it.',
	'',
	'Overtime — planned, never derived',
	'',
	'• A cell is the TOTAL overtime planned on that day, in hours after the shift: 0.5, 1, 1.5 and so',
	'  on, at most 24. A blank cell is none. Overtime is never derived from the clock.',
	'',
	'• Overtime never refuses the file. Every statutory overtime ceiling splits each day’s total in',
	'  date order: the hours within all of them are stored as overtime, the rest as incentive hours,',
	'  which payroll pays on the INCENTIVE line at the rate and multiple of the band they fall in.',
	'  The ceilings are the daily total (e.g. 12 worked hours, shift included) and daily overtime',
	'  (e.g. 4 hours on an ordinary day), and the weekly, monthly, quarterly and yearly overtime',
	'  (e.g. 18 a week, 104 or 72 a month, 138 a quarter, 200 a year); overtime on a rest day, off',
	'  day or holiday counts toward the weekly and longer ones.',
	'',
	'What is refused — hard requirements',
	'',
	'The whole file is refused, not individual rows, and the refusal names the person, the day and',
	'the rule:',
	'• an unknown employee or roster code, a day outside the Settings month, a duplicate inside the',
	'  file, a missing day on a rostered person, a sealed day the file would change, PH in a cell, a',
	'  clock time or overtime figure that is not valid, attendance or overtime on a full leave day;',
	'• more consecutive working days than the weekly rest rule allows (e.g. 7 in a row where the',
	'  rule is a rest day in every 6);',
	'• a shift granting less break than the rules owe for its length;',
	'• a shift overlapping the same person’s shift on the neighbouring day;',
	'• a shift whose own paid hours exceed the daily total ceiling (e.g. 12), or whose spread-over,',
	'  break included, exceeds the daily spread-over ceiling (e.g. 10).',
	'',
	'Accepted values',
	'',
	'employee_number   as seeded on the employment, e.g. PUBEM0002',
	'Roster day columns 1–31 (or YYYY-MM-DD) for the Settings month',
	'Roster cell       an existing roster code, e.g. 7.5AM · 8.0AM · 8.5AM · AM0830 · AM1030 ·',
	'                  PM2030 · PM2230 · REST · OFF',
	'Time entries row  employee_number, work_date as YYYY-MM-DD, clock_in, and clock_out once the',
	'                  shift is closed — each clock time HH:mm, 24-hour',
	'Overtime cell     the day’s total planned hours in half-hour steps, 0.5–24; blank is none',
	'',
	'A Roster sheet as a long-form table (employee_number, work_date, shift_code) still imports, and',
	'so does a month-grid Time entries sheet with HH:mm-HH:mm cells and a long-form Overtime sheet',
	'(employee_number, work_date, overtime_hours).',
	'',
	'The sample rows below are illustrative. Delete them and paste your own.'
];

function newWorkbook() {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = 'Norbital';
	workbook.lastModifiedBy = 'Norbital';
	workbook.created = EPOCH;
	workbook.modified = EPOCH;
	return workbook;
}

/** One text cell per line, in a single column wide enough to read without wrapping. */
function addReadmeSheet(workbook, lines) {
	const worksheet = workbook.addWorksheet('Read me first');
	worksheet.getColumn(1).width = 118;
	for (const line of lines) worksheet.addRow([line]);
	return worksheet;
}

function addTableSheet(workbook, name, columnWidths, header, rows) {
	const worksheet = workbook.addWorksheet(name);
	columnWidths.forEach((width, index) => {
		worksheet.getColumn(index + 1).width = width;
	});
	worksheet.addRow(header);
	for (const row of rows) worksheet.addRow(row);
	return worksheet;
}

function settingMap(workbook) {
	const sheet = workbook.getWorksheet('Settings');
	const settings = new Map();
	sheet?.eachRow((row) => {
		const key = String(row.getCell(1).value ?? '')
			.trim()
			.toLowerCase()
			.replaceAll(/[\s-]+/g, '_');
		const value = String(row.getCell(2).value ?? '').trim();
		if (key === '' || key === 'setting' || value === '') return;
		settings.set(key, value);
	});
	return settings;
}

const writeWorkbook = (workbook, targetPath) =>
	Effect.gen(function* () {
		yield* Effect.tryPromise(() => workbook.xlsx.writeFile(targetPath));

		// Read back what was shipped, and refuse to call it done if it is not exactly the template.
		const reloaded = new ExcelJS.Workbook();
		yield* Effect.tryPromise(() => reloaded.xlsx.readFile(targetPath));
		return reloaded;
	});

function headersOf(workbook, sheetName) {
	const headerRow = workbook.getWorksheet(sheetName)?.getRow(1);
	const headers = [];
	headerRow?.eachCell({ includeEmpty: true }, (cell) => headers.push(String(cell.value ?? '')));
	return headers;
}

function cellOf(workbook, sheetName, rowNumber, header) {
	const sheet = workbook.getWorksheet(sheetName);
	const headers = headersOf(workbook, sheetName);
	const column = headers.indexOf(header) + 1;
	return String(sheet?.getRow(rowNumber).getCell(column).value ?? '').trim();
}

const schedulingWorkbook = newWorkbook();
addReadmeSheet(schedulingWorkbook, SCHEDULING_README);
addTableSheet(schedulingWorkbook, 'Settings', [22, 42], SETTINGS_ROWS[0], SETTINGS_ROWS.slice(1));
addTableSheet(
	schedulingWorkbook,
	'Roster',
	[18, ...DAY_HEADERS.map(() => 10)],
	GRID_HEADERS,
	ROSTER_SAMPLE_ROWS
);
addTableSheet(
	schedulingWorkbook,
	'Time entries',
	[18, 14, 12, 12],
	TIME_ENTRY_HEADERS,
	TIME_ENTRY_SAMPLE_ROWS
);
addTableSheet(
	schedulingWorkbook,
	'Overtime',
	[18, ...DAY_HEADERS.map(() => 8)],
	GRID_HEADERS,
	OVERTIME_SAMPLE_ROWS
);
const holidaysWorkbook = newWorkbook();
addReadmeSheet(holidaysWorkbook, HOLIDAY_README);
addTableSheet(
	holidaysWorkbook,
	SAMPLE_LEGAL_ENTITY,
	[14, 40, 16],
	HOLIDAY_HEADERS,
	HOLIDAY_SAMPLE_ROWS
);
Effect.runPromise(
	Effect.gen(function* () {
		const holidaysShipped = yield* writeWorkbook(holidaysWorkbook, HOLIDAYS_TEMPLATE_PATH);
		assert.deepEqual(
			[...holidaysShipped.worksheets.map((sheet) => sheet.name)],
			['Read me first', SAMPLE_LEGAL_ENTITY]
		);
		assert.deepEqual(headersOf(holidaysShipped, SAMPLE_LEGAL_ENTITY), HOLIDAY_HEADERS);
		assert.equal(cellOf(holidaysShipped, SAMPLE_LEGAL_ENTITY, 2, 'date'), '2027-01-01');
		console.log(`${HOLIDAYS_TEMPLATE_PATH}`);
		console.log(`  sheets: Read me first, ${SAMPLE_LEGAL_ENTITY}`);
		const shipped = yield* writeWorkbook(schedulingWorkbook, SCHEDULING_TEMPLATE_PATH);
		assert.deepEqual(
			[...shipped.worksheets.map((sheet) => sheet.name)],
			['Read me first', 'Settings', 'Roster', 'Time entries', 'Overtime']
		);
		assert.deepEqual(headersOf(shipped, 'Roster'), GRID_HEADERS);
		assert.deepEqual(headersOf(shipped, 'Overtime'), GRID_HEADERS);
		assert.deepEqual(headersOf(shipped, 'Time entries'), TIME_ENTRY_HEADERS);
		assert.deepEqual(
			[...settingMap(shipped)],
			[
				['legal_entity', SAMPLE_LEGAL_ENTITY],
				['month', SAMPLE_MONTH],
				['timezone', SAMPLE_TIMEZONE]
			]
		);
		assert.equal(cellOf(shipped, 'Roster', 2, '1'), '7.5AM');
		assert.equal(cellOf(shipped, 'Roster', 2, '3'), 'REST');
		assert.equal(cellOf(shipped, 'Roster', 3, '6'), 'OFF');
		assert.equal(cellOf(shipped, 'Time entries', 2, 'clock_in'), '08:16');
		assert.equal(cellOf(shipped, 'Time entries', 2, 'clock_out'), '17:10');
		assert.equal(cellOf(shipped, 'Time entries', 6, 'clock_in'), '20:31');
		assert.equal(cellOf(shipped, 'Time entries', 6, 'clock_out'), '');
		assert.equal(cellOf(shipped, 'Overtime', 2, '4'), '2');
		assert.equal(cellOf(shipped, 'Overtime', 2, '5'), '1.5');

		console.log(`${SCHEDULING_TEMPLATE_PATH}`);
		console.log(`  sheets: Read me first, Settings, Roster, Time entries, Overtime`);
		console.log(`  grid header: employee_number, 1–${DAY_HEADERS.at(-1)} (${SAMPLE_MONTH})`);
		console.log(`  Time entries columns: ${TIME_ENTRY_HEADERS.join(', ')}`);
	})
);
