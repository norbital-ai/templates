/**
 * The scheduling workbook the operator is issued, built from the same grammar the reader accepts.
 *
 * The sheet names come from `import-workbook.ts` and the Settings keys from `workbook-settings.ts`,
 * so the file handed out and the file the importer reads cannot drift apart. The dev script
 * (`scripts/generate-import-templates.mjs`) writes the same layout to the desktop for review; this
 * is the copy the app hands an operator, prefilled with the entity and the month the board is on.
 *
 * A header row and nothing else: the reader refuses a file with nothing to import, which is the
 * correct answer for a template nobody has filled in yet.
 */

import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type ln from 'exceljs';
import { SETTINGS_SHEET_NAME } from '../../../lib/workbook-settings.js';
import { calendarDaysInMonth } from '../../../lib/period.js';
import { ATTENDANCE_SHEET_NAME, ROSTER_SHEET_NAME } from './import-workbook.js';

const READ_ME_SHEET_NAME = 'Read me first';

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const READ_ME_LINES = [
	'Scheduling import — one legal entity, one month, two sheets',
	'',
	'"Roster" is the planned assignment: who is scheduled where, one person per row and one',
	"calendar day per column. A cell holds one of the entity's roster codes (a shift, REST or OFF).",
	'Blank cells are days nobody assigned — they are not inferred rest days.',
	'',
	'"Time entries" is what actually happened on the clock, one person-day per row with a',
	'clock_in and a clock_out column, each a local wall time HH:mm. A blank clock_out is a day',
	'still open. Overtime is calculated from the actual presence and the effective schedule; a',
	'workbook cannot assert it as a second class of time, so an overtime column is never read.',
	'',
	'The "Settings" sheet states the legal entity, the month (YYYY-MM) and the IANA timezone once.',
	'Do not rename the sheets or the columns: the importer refuses the whole file by name.',
	"Every row is checked against the entity's records — employee numbers, shift codes, holidays —",
	'and one bad row refuses the whole file so it can be corrected and re-imported as one.'
];

export function schedulingTemplateWorkbook(options: {
	readonly legalEntity: string;
	readonly month: string;
	readonly timezone: string;
}): ln.Workbook {
	const workbook = new ExcelJSBrowser.Workbook();
	const readMe = workbook.addWorksheet(READ_ME_SHEET_NAME);
	for (const line of READ_ME_LINES) readMe.addRow([line]);

	const settings = workbook.addWorksheet(SETTINGS_SHEET_NAME);
	settings.addRow(['Setting', 'Value']);
	settings.addRow(['legal_entity', options.legalEntity]);
	settings.addRow(['month', options.month]);
	settings.addRow(['timezone', options.timezone]);
	settings.addRow([]);
	settings.addRow(['', 'The employing legal entity as named on file, or its registration number.']);
	settings.addRow(['', 'A payroll month as YYYY-MM. Day columns 1–31 are days of this month.']);
	settings.addRow([
		'',
		'An IANA timezone name, e.g. Asia/Kuala_Lumpur. Required when Time entries carry punches.'
	]);

	const roster = workbook.addWorksheet(ROSTER_SHEET_NAME);
	roster.addRow([
		'employee_number',
		...calendarDaysInMonth(options.month).map((day) => String(Number(day.slice(-2))))
	]);

	const attendance = workbook.addWorksheet(ATTENDANCE_SHEET_NAME);
	attendance.addRow(['employee_number', 'work_date', 'clock_in', 'clock_out']);

	return workbook;
}
