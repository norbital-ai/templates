/**
 * The scheduling workbook the operator is issued, built from the same grammar the reader accepts.
 *
 * The sheet names come from `import-workbook.ts` and the Settings keys from `workbook-settings.ts`,
 * so the file handed out and the file the importer reads cannot drift apart. The dev script
 * (`scripts/generate-import-templates.mjs`) writes the same layout to the desktop for review; this
 * is the copy the app hands an operator, prefilled with the entity and the month the board is on.
 *
 * Empty sheets are an explicit replacement: their editable recorded values in the selected entity/month are cleared.
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
	'Every sheet is a month grid: one person per row (employee_number), one column per',
	'day of the month (1–31), one cell per person-day.',
	'Upload SET replaces every recorded entry for the selected legal entity and month.',
	'Blank cells and omitted people clear editable entries on each supplied sheet.',
	'A sheet omitted from the workbook leaves its entries unchanged.',
	'',
	'A. Roster (the plan): a shift code, REST or OFF in each cell.',
	'   Never type PH: holidays come from the worksite holiday calendar.',
	'   A blank cell writes no plan: the day follows the work pattern and is paid as',
	'   present. The import still loads and lists the blank days as a warning — use it',
	'   for leave not yet entered, or the days after someone leaves.',
	'',
	'B. Day type (derived, never typed): working, rest, off, public holiday',
	'   (observed or substituted) or leave, from the roster, the holiday calendar',
	'   and approved leave.',
	'',
	'C. Overtime (pre-approved hours): the day’s total extra hours in each cell.',
	'   - working day: the hours after the shift;',
	'   - REST, OFF or a holiday not normally worked: the total hours worked;',
	'   - hours above the statutory cap become incentive hours at the overtime band rate.',
	'',
	'D. Time entries (the clock): each cell is the day’s clock in and out as local',
	'   HH:mm-HH:mm, e.g. 08:00-17:00. Several intervals (a split shift) go in one cell,',
	'   separated by ; or a new line: 08:00-12:00; 13:00-17:00. A last interval with no',
	'   close (08:00) is a day still open; a close at or before the open is the next day.',
	'   - proves presence;',
	'   - a rostered working day with no clock entry is an absence and deducts pay;',
	'   - clocked time beyond planned overtime is not paid.',
	'',
	'Examples (shift D = 09:00–18:00):',
	'   Working day + 2 h OT: Roster D, Overtime 2, Time entries 09:00-20:00.',
	'   Rest day + 6 h: Roster REST, Overtime 6, Time entries 09:00-15:00.',
	'   Holiday on a working day: Roster D; the calendar marks the holiday.',
	'   Holiday on a rest day: Roster REST; the holiday is substituted.',
	'   Absence: Roster D, Time entries blank.',
	'',
	'Statutory limits never refuse the file: more consecutive working days than the',
	'weekly rest rule allows, hours or spread-over above a ceiling, a shift with less',
	'break than the rules owe, and overtime above a cap are imported and listed as',
	'warnings.',
	'',
	'Cut-off: an entry is paid in the run whose attendance window holds its date',
	'(e.g. 21 Dec – 20 Jan), not by calendar month. After the cut-off = next run.',
	'Lock: an entry consumed by a paid individual payslip is sealed, for any run kind.',
	'Changing or omitting a locked entry refuses the whole upload; identical entries pass.',
	'Correct paid entries with an adjustment entry in the next cycle.',
	'Unpaid draft entries remain editable; recalculate payroll after replacing them.',
	'',
	'Settings: legal entity, month (YYYY-MM), IANA timezone.',
	'Where the rules ask for per-occasion consent or declare work-day inputs, Overtime is',
	'one person-day per row: overtime_hours, the consent instant, one column per input.',
	'Do not rename sheets or columns. A malformed cell (unknown code, bad time or hours)',
	'refuses the whole file.'
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

	const grid = [
		'employee_number',
		...eachDay(monthOf(`${options.month}-01`)).map((day) =>
			String(Number.parseInt(day.slice(-2), 10))
		)
	];
	workbook.addWorksheet(ROSTER_SHEET_NAME).addRow(grid);
	workbook.addWorksheet(ATTENDANCE_SHEET_NAME).addRow(grid);

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
			: grid
	);

	return workbook;
}
