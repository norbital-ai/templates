/**
 * The two import templates operators are issued, written to `~/Desktop`.
 *
 * The sheets mirror exactly what the readers in `src/collections/roster_entries/lib` and
 * `src/collections/time_entries/lib` accept as the designed layout: one legal entity × one month,
 * a person down the side and a calendar day across the top. Roster cells carry a company roster
 * code (or the reserved `PH` token). Time-entry cells carry a local punch range `HH:mm-HH:mm`, or
 * `HH:mm` when still open. Blank cells are omitted — they are not inferred rest days and not
 * punchless leave. The timezone, legal entity and month are declared once on the `Settings` sheet.
 *
 * Long-form person-day sheets (`employee_number`, `work_date`, `shift_code` / `clock_in` /
 * `clock_out`, and optionally `break_minutes` in minutes — not hours) still import. These files
 * are the ones operators are issued. The `Read me first` sheets state the rules in the same terms
 * the readers enforce them, so what the file promises and what the import accepts cannot drift
 * apart quietly.
 *
 * The script is re-runnable and deterministic: the workbook metadata is pinned to a fixed instant,
 * so two runs emit the same bytes, and it reads each file back on the way out and asserts the
 * header row and Settings keys it shipped.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
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

const ROSTER_TEMPLATE_PATH = path.join(
	os.homedir(),
	'Desktop',
	'norbital-roster-import-template.xlsx'
);
const TIME_TEMPLATE_PATH = path.join(
	os.homedir(),
	'Desktop',
	'norbital-time-entries-import-template.xlsx'
);

const SAMPLE_MONTH = '2026-05';
const SAMPLE_LEGAL_ENTITY = 'Nihon Pigment Sdn. Bhd.';
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
	gridRow('NHPMY0002', { 1: '7.5AM', 2: '7.5AM', 3: 'REST', 4: '7.5AM', 5: '7.5AM' }, SAMPLE_MONTH),
	gridRow('NHPMY0023', { 4: 'AM0830', 5: 'PM2030', 6: 'OFF' }, SAMPLE_MONTH)
];

const TIME_ENTRY_SAMPLE_ROWS = [
	gridRow('NHPMY0002', { 4: '08:16-17:10', 5: '08:02-17:05' }, SAMPLE_MONTH),
	gridRow('NHPMY0023', { 4: '20:30-05:15', 5: '20:28-05:02', 6: '20:31' }, SAMPLE_MONTH)
];

const ROSTER_SETTINGS_ROWS = [
	['Setting', 'Value'],
	['legal_entity', SAMPLE_LEGAL_ENTITY],
	['month', SAMPLE_MONTH],
	[],
	['', 'The employing legal entity as named on file, or its registration number.'],
	['', 'A payroll month as YYYY-MM. Day columns 1–31 are days of this month.']
];

const TIME_SETTINGS_ROWS = [
	['Setting', 'Value'],
	['legal_entity', SAMPLE_LEGAL_ENTITY],
	['month', SAMPLE_MONTH],
	['timezone', SAMPLE_TIMEZONE],
	[],
	['', 'An IANA timezone name. Asia/Kuala_Lumpur, Asia/Manila, Asia/Jakarta, Asia/Singapore.']
];

const ROSTER_README = [
	'Roster import — planned assignment (one legal entity, one month)',
	'',
	'One person per row and one calendar day per column, on the "Roster" sheet. Do not rename the',
	'sheet or the column headers. Set legal_entity and month once, on the "Settings" sheet.',
	'',
	'A roster is a work ASSIGNMENT — who is scheduled where. It is not attendance. Use the time-entries',
	'template for what actually happened on the clock. Importing one does not populate the other.',
	'',
	'Three rules that change what people get paid',
	'',
	'• A filled cell is an explicit assignment to that roster code on that day. A blank cell is an',
	'  absent assignment — it is not inferred as a rest day. REST, OFF and the reserved token PH must',
	'  be written when they are meant.',
	'',
	'• A cell must name an existing roster code (or PH). The hours a working day earns are measured',
	'  against the code it names, so a code the company has not defined refuses the file.',
	'',
	"• PH is checked against the legal entity's holiday calendar and is not stored as a person-day",
	'  fact. Configure the holiday first; a PH cell on a day that is not observed refuses the file.',
	'',
	'What is refused',
	'',
	'The whole file is refused, not individual rows, and the offending cells are named: unknown',
	'employee or roster code, a day outside the Settings month, an already-published roster,',
	'duplicates inside the file, and days already on file.',
	'',
	'Accepted values',
	'',
	'employee_number   as seeded on the employment, e.g. NHPMY0002',
	'day columns       1–31 (or YYYY-MM-DD) for the Settings month',
	'cell              an existing roster code, e.g. 7.5AM · 8.0AM · 8.5AM · AM0830 · AM1030 ·',
	'                  PM2030 · PM2230 · REST · OFF — or PH on an observed holiday',
	'',
	'A long-form sheet with employee_number, work_date and shift_code still imports, and may also',
	'carry assignment_code (the token your source schedule shows) and note (why the day was changed).',
	'Both are stored on the assignment; the schedule itself always comes from shift_code. The month',
	'grid has no column for either. These files are the ones operators are issued.',
	'',
	'The sample rows below are illustrative. Delete them and paste your own.'
];

const TIME_README = [
	'Time entries import — actual attendance (one legal entity, one month)',
	'',
	'One person per row and one calendar day per column, on the "Time entries" sheet. Do not rename',
	'the sheet or the column headers.',
	'',
	'Set legal_entity, month and timezone once, on the "Settings" sheet. Every clock time in this file',
	'is read as local wall time in that zone and converted to a real instant. We do not use a fixed',
	'UTC offset, so daylight saving and historical changes are handled correctly.',
	'',
	'Three rules worth knowing',
	'',
	'• A cell is a punch range. HH:mm-HH:mm is a closed day; HH:mm alone is still open; a blank cell',
	'  is no punch. An overnight shift needs no special marker — a clock_out at or before clock_in is',
	'  treated as the next calendar day.',
	'',
	'• A cell carries punches only — breaks, overtime and the open/closed state are derived from them.',
	'  The issued grid has no break_minutes column. A long-form sheet may still carry break_minutes',
	'  (minutes, not hours); the UI label in hours does not change the workbook column name.',
	'',
	'• A leave day is NOT a time entry. Leave lives in its own record so it can be approved and audited;',
	'  do not add punchless cells to stand in for it.',
	'',
	'Accepted values',
	'',
	'employee_number   as seeded on the employment, e.g. NHPMY0002',
	'day columns       1–31 (or YYYY-MM-DD) for the Settings month',
	'cell              HH:mm-HH:mm, 24-hour, local to the timezone on the Settings sheet — or HH:mm',
	'                  when the close has not landed yet',
	'',
	'A long-form sheet with employee_number, work_date, clock_in and clock_out still imports. These',
	'files are the ones operators are issued.',
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

async function writeWorkbook(workbook, targetPath) {
	await workbook.xlsx.writeFile(targetPath);

	// Read back what was shipped, and refuse to call it done if it is not exactly the template.
	const reloaded = new ExcelJS.Workbook();
	await reloaded.xlsx.readFile(targetPath);
	return reloaded;
}

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

const rosterWorkbook = newWorkbook();
addReadmeSheet(rosterWorkbook, ROSTER_README);
addTableSheet(
	rosterWorkbook,
	'Settings',
	[22, 42],
	ROSTER_SETTINGS_ROWS[0],
	ROSTER_SETTINGS_ROWS.slice(1)
);
addTableSheet(
	rosterWorkbook,
	'Roster',
	[18, ...DAY_HEADERS.map(() => 10)],
	GRID_HEADERS,
	ROSTER_SAMPLE_ROWS
);
const rosterShipped = await writeWorkbook(rosterWorkbook, ROSTER_TEMPLATE_PATH);
assert.deepEqual(
	[...rosterShipped.worksheets.map((sheet) => sheet.name)],
	['Read me first', 'Settings', 'Roster']
);
assert.deepEqual(headersOf(rosterShipped, 'Roster'), GRID_HEADERS);
assert.deepEqual(
	[...settingMap(rosterShipped)],
	[
		['legal_entity', SAMPLE_LEGAL_ENTITY],
		['month', SAMPLE_MONTH]
	]
);
assert.equal(cellOf(rosterShipped, 'Roster', 2, '1'), '7.5AM');
assert.equal(cellOf(rosterShipped, 'Roster', 2, '3'), 'REST');
assert.equal(cellOf(rosterShipped, 'Roster', 3, '6'), 'OFF');

const timeWorkbook = newWorkbook();
addReadmeSheet(timeWorkbook, TIME_README);
addTableSheet(
	timeWorkbook,
	'Settings',
	[22, 42],
	TIME_SETTINGS_ROWS[0],
	TIME_SETTINGS_ROWS.slice(1)
);
addTableSheet(
	timeWorkbook,
	'Time entries',
	[18, ...DAY_HEADERS.map(() => 14)],
	GRID_HEADERS,
	TIME_ENTRY_SAMPLE_ROWS
);
const timeShipped = await writeWorkbook(timeWorkbook, TIME_TEMPLATE_PATH);
assert.deepEqual(
	[...timeShipped.worksheets.map((sheet) => sheet.name)],
	['Read me first', 'Settings', 'Time entries']
);
assert.deepEqual(headersOf(timeShipped, 'Time entries'), GRID_HEADERS);
assert.deepEqual(
	[...settingMap(timeShipped)],
	[
		['legal_entity', SAMPLE_LEGAL_ENTITY],
		['month', SAMPLE_MONTH],
		['timezone', SAMPLE_TIMEZONE]
	]
);
assert.equal(cellOf(timeShipped, 'Time entries', 2, '4'), '08:16-17:10');
assert.equal(cellOf(timeShipped, 'Time entries', 3, '6'), '20:31');
assert.ok(
	!headersOf(timeShipped, 'Time entries').includes('break_minutes'),
	'the issued month grid has no break_minutes column — that name belongs to long-form sheets only'
);

console.log(`${ROSTER_TEMPLATE_PATH}`);
console.log(`  sheets: Read me first, Settings, Roster`);
console.log(`  Roster header: employee_number, 1–${DAY_HEADERS.at(-1)} (${SAMPLE_MONTH})`);
console.log(`${TIME_TEMPLATE_PATH}`);
console.log(`  sheets: Read me first, Settings, Time entries`);
console.log(`  Time entries header: employee_number, 1–${DAY_HEADERS.at(-1)} (${SAMPLE_MONTH})`);
