/**
 * The two import templates operators are issued, written to `~/Desktop` (or the directory named by
 * `IMPORT_TEMPLATE_DIR`): the scheduling workbook (Roster, Time entries and Overtime sheets) and
 * the holidays workbook.
 *
 * The sheets mirror exactly what the reader in `src/data/collection/work_days/lib` accepts as the
 * designed layout — one entity × one month. Every sheet is a month grid: a person down the side
 * and a calendar day across the top. Roster cells carry a company roster code; a blank one writes
 * no plan and is reported as a warning. Time entries cells carry the day's clock as local
 * `HH:mm-HH:mm` intervals, several to a cell separated by `;` or a new line; a last interval with
 * no close is still open. Overtime cells carry the day's total extra hours, which the import splits
 * into approved overtime and incentive hours. A blank Time entries or Overtime cell is none. The
 * timezone, legal entity and month are declared once on the `Settings` sheet.
 *
 * Long-form sheets (`employee_number`, `work_date`, …) still import, including the files operators
 * already have on disk — but the issued template is the three grids. The
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

const TIME_ENTRY_SAMPLE_ROWS = [
	gridRow('PUBEM0002', { 4: '08:16-17:10', 5: '08:02-12:00; 13:00-17:05' }, SAMPLE_MONTH),
	gridRow('PUBEM0023', { 4: '20:30-05:15', 5: '20:28-05:02', 6: '20:31' }, SAMPLE_MONTH)
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
	'Every sheet is a month grid: one person per row and one calendar day per column. "Roster" is',
	'the planned assignment, "Time entries" is what actually happened on the clock and "Overtime" is',
	'the extra hours, each cell the day’s total. Do not rename the sheets or the column headers.',
	'Set legal_entity, month and timezone once, on the "Settings" sheet.',
	'',
	'The file is the state of the month it names, for every employee of the entity. Import it again',
	'and the month becomes what the file now says; a person the file no longer names loses the month',
	'and falls back to their work pattern. A file carrying only some of the sheets replaces only',
	'those halves. A blank Roster cell is allowed — leave not yet entered, the days after someone',
	'leaves — and writes no plan: the day follows the work pattern, and the import lists it as a warning.',
	'A day a payslip has already taken into account may be restated as it is; a file that changes or',
	'omits one is refused naming those days.',
	'',
	'Roster — three rules that change what people get paid',
	'',
	'• A filled cell is an explicit assignment to that roster code on that day. A blank cell is an',
	'  absent assignment — it is not inferred as a rest day; the work pattern decides the day, and the',
	'  import warns. REST and OFF must be written when they are meant.',
	'',
	'• A cell must name an existing roster code. The hours a working day earns are measured against',
	'  the code it names, so a code the company has not defined refuses the file.',
	'',
	'• PH is not a roster code. Holidays are overlaid from the legal entity’s published calendar;',
	'  the cell names the shift the person would have worked, or REST or OFF.',
	'',
	'Time entries — three rules worth knowing',
	'',
	'• Each cell is one person-day: the clock in and out as HH:mm-HH:mm, 24-hour, e.g. 08:00-17:00.',
	'  A split shift is several intervals in one cell, separated by ; or a new line:',
	'  08:00-12:00; 13:00-17:00. A last interval with no close (20:31) is still open; an overnight',
	'  shift needs no marker — a close at or before its open is the next calendar day. Every clock',
	'  time is local wall time in the Settings timezone. A blank cell is no attendance.',
	'',
	'• The cells carry punches only — breaks and the open/closed state are derived from them. The',
	'  break is the shift’s granted break, less any gap already visible between the intervals.',
	'',
	'• A leave day is NOT a time entry. Leave lives in its own record so it can be approved and audited;',
	'  do not add punchless cells to stand in for it.',
	'',
	'Overtime — planned, never derived',
	'',
	'• A cell is the TOTAL overtime planned on that day, in hours after the shift: 0.5, 1, 1.5 and so',
	'  on, at most 24. A blank cell is none. Overtime is never derived from the clock.',
	'',
	'• A cell is the day’s shift (on the Roster sheet) plus its TOTAL extra hours here. The import',
	'  splits each total at the statutory overtime ceilings, in date order and around the days of',
	'  the same periods already on file: the hours within all of them are written as approved',
	'  overtime, the rest as incentive hours, which payroll pays on the INCENTIVE line at the rate',
	'  and multiple of the band they fall in. The split never refuses the file; it warns. The ceilings are the',
	'  daily total (e.g. 12 worked hours, shift included) and daily overtime (e.g. 4 hours on an',
	'  ordinary day), and the weekly, monthly, quarterly and yearly overtime (e.g. 18 a week, 104 or',
	'  72 a month, 138 a quarter, 200 a year); overtime on a rest day, off day or holiday counts',
	'  toward the weekly and longer ones. The split happens only here: on the day sheet the two',
	'  figures are keyed apart, approved overtime up to the maximum the sheet shows.',
	'',
	'• A company holiday worked by someone the overtime rule does not cover is imported, and the',
	'  import warns: no overtime is paid for it, so grant an off-in-lieu (OIL) leave day.',
	'',
	'What is refused — malformed input only',
	'',
	'The whole file is refused, not individual rows, and the refusal names the person, the day and',
	'the rule:',
	'• an unknown employee or roster code, a day no contract covers, a day outside the Settings',
	'  month, a duplicate inside the file, a sealed day the file would change, PH in a cell, a clock',
	'  time or overtime figure that is not valid, attendance or overtime on a full leave day;',
	'• a shift overlapping the same person’s shift on the neighbouring day.',
	'',
	'What is warned — imported, and listed after the import',
	'',
	'• a blank roster day on an employed person;',
	'• more consecutive working days than the weekly rest rule allows (e.g. 9 in a row after a',
	'  shift change, where the rule is a rest day in every 6);',
	'• a shift granting less break than the rules owe for its length;',
	'• a plan whose hours exceed a daily or period total ceiling (e.g. 12 a day), or whose',
	'  spread-over, break included, exceeds the spread-over ceiling (e.g. 10);',
	'• overtime above a statutory cap, recorded as incentive hours.',
	'',
	'Accepted values',
	'',
	'employee_number   as seeded on the employment, e.g. PUBEM0002',
	'Roster day columns 1–31 (or YYYY-MM-DD) for the Settings month',
	'Roster cell       an existing roster code, e.g. 7.5AM · 8.0AM · 8.5AM · AM0830 · AM1030 ·',
	'                  PM2030 · PM2230 · REST · OFF',
	'Time entries cell HH:mm-HH:mm, 24-hour; several separated by ; or a new line; blank is none',
	'Overtime cell     the day’s total extra hours in half-hour steps, 0.5–24; blank is none',
	'',
	'Long-form sheets still import: Roster (employee_number, work_date, shift_code), Time entries',
	'(employee_number, work_date, clock_in, clock_out — one row per interval) and Overtime',
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
	[18, ...DAY_HEADERS.map(() => 14)],
	GRID_HEADERS,
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
		assert.deepEqual(headersOf(shipped, 'Time entries'), GRID_HEADERS);
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
		assert.equal(cellOf(shipped, 'Time entries', 2, '4'), '08:16-17:10');
		assert.equal(cellOf(shipped, 'Time entries', 2, '5'), '08:02-12:00; 13:00-17:05');
		assert.equal(cellOf(shipped, 'Time entries', 3, '6'), '20:31');
		assert.equal(cellOf(shipped, 'Overtime', 2, '4'), '2');
		assert.equal(cellOf(shipped, 'Overtime', 2, '5'), '1.5');

		console.log(`${SCHEDULING_TEMPLATE_PATH}`);
		console.log(`  sheets: Read me first, Settings, Roster, Time entries, Overtime`);
		console.log(`  grid header: employee_number, 1–${DAY_HEADERS.at(-1)} (${SAMPLE_MONTH})`);
	})
);
