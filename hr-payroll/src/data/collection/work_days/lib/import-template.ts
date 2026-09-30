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
import { SETTINGS_SHEET_NAME } from '../../../../lib/workbook-settings.js';
import { eachDay, monthOf } from '@norbital-ai/std/date';
import {
	ATTENDANCE_SHEET_NAME,
	OVERTIME_SHEET_NAME,
	ROSTER_SHEET_NAME
} from './import-workbook.js';

const READ_ME_SHEET_NAME = 'Read me first';

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const READ_ME_LINES = [
	'Scheduling import — one legal entity, one month',
	'',
	'A. Roster (the plan): a shift code, REST or OFF for every day.',
	'   Never type PH: holidays come from the worksite holiday calendar.',
	'   A blank cell is unassigned, not a rest day.',
	'',
	'B. Day type (derived, never typed): working, rest, off, public holiday',
	'   (observed or substituted) or leave, from the roster, the holiday calendar',
	'   and approved leave.',
	'',
	'C. Overtime (pre-approved hours):',
	'   - working day: the hours after the shift;',
	'   - REST, OFF or a holiday not normally worked: the total hours worked;',
	'   - hours above the statutory cap become incentive hours at the overtime band rate.',
	'',
	'D. Time entries (the clock): clock_in, clock_out as local HH:mm.',
	'   A blank clock_out is a day still open.',
	'   - proves presence;',
	'   - a rostered working day with no clock entry is an absence and deducts pay;',
	'   - clocked time beyond planned overtime is not paid.',
	'',
	'Examples (shift D = 09:00–18:00):',
	'   Working day + 2 h OT: Roster D, Overtime 2, clock 09:00–20:00.',
	'   Rest day + 6 h: Roster REST, Overtime 6, clock 09:00–15:00.',
	'   Holiday on a working day: Roster D; the calendar marks the holiday.',
	'   Holiday on a rest day: Roster REST; the holiday is substituted.',
	'   Absence: Roster D, no clock entry.',
	'',
	'Cut-off: an entry is paid in the run whose attendance window holds its date',
	'(e.g. 21 Dec – 20 Jan), not by calendar month. After the cut-off = next run.',
	'Lock: a day or entry a run consumed is sealed; correct it with an adjustment',
	'entry in the next cycle.',
	'',
	'Settings: legal entity, month (YYYY-MM), IANA timezone.',
	'Where the rules ask for per-occasion consent or declare work-day inputs, Overtime is',
	'one person-day per row: overtime_hours, the consent instant, one column per input.',
	'Do not rename sheets or columns. One bad row refuses the whole file.'
];

export function schedulingTemplateWorkbook(options: {
	readonly legalEntity: string;
	readonly month: string;
	readonly timezone: string;
	/** The version asks each overtime occasion for consent (`work_rules.overtime_consent`). */
	readonly overtimeConsent?: boolean | undefined;
	/** The declared work-day inputs the workbook carries (`work_day_facts[].import`). */
	readonly factColumns?: readonly string[] | undefined;
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
		...eachDay(monthOf(`${options.month}-01`)).map((day) =>
			String(Number.parseInt(day.slice(-2), 10))
		)
	]);

	const attendance = workbook.addWorksheet(ATTENDANCE_SHEET_NAME);
	attendance.addRow(['employee_number', 'work_date', 'clock_in', 'clock_out']);

	const overtime = workbook.addWorksheet(OVERTIME_SHEET_NAME);
	overtime.addRow(
		options.overtimeConsent === true || (options.factColumns ?? []).length > 0
			? [
					'employee_number',
					'work_date',
					'overtime_hours',
					...(options.overtimeConsent === true ? ['overtime_consented_at'] : []),
					...(options.factColumns ?? [])
				]
			: [
					'employee_number',
					...eachDay(monthOf(`${options.month}-01`)).map((day) =>
						String(Number.parseInt(day.slice(-2), 10))
					)
				]
	);

	return workbook;
}
