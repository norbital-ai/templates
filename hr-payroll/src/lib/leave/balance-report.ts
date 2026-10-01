/**
 * The leave balance export: one row per person, one column band per leave type, every figure the
 * `leave_balance_report` query answers (the profile's `leave_balances`, never recomputed). Total less
 * Taken and Forfeit is Bal. Styled as the payroll workbook's salary listing.
 */

import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type ExcelJS from 'exceljs';
import type { Id } from '@norbital-ai/bolt';
import type { LeaveBalanceSummaries } from './summary.js';

export type LeaveBalanceReportRow = {
	readonly employee_number: string;
	readonly name: string;
	/** The service start the entitlement counts from. */
	readonly service_start: string;
	readonly balances: LeaveBalanceSummaries;
	/** A refused calculation leaves all this person's balance cells unknown. */
	readonly issue?: string;
};
/** Bounded query response; callers continue until next_cursor is null. */
export type LeaveBalanceReportPage = {
	readonly rows: readonly LeaveBalanceReportRow[];
	readonly next_cursor: Id<'employments'> | null;
};

type Balance = LeaveBalanceSummaries[number];

const NAVY = 'FF17365D';
const LIGHT_BLUE = 'FFD9EAF7';
const THIN = { style: 'thin', color: { argb: 'FFB8B5A8' } } as const;
const DAY = 'dd-mm-yyyy';
const FIRST_BAND_ROW = 4;
const HEADER_ROW = 5;
const IDENTITY = [
	{ header: 'Employee Code', width: 16 },
	{ header: 'Name', width: 32 },
	{ header: 'Leave Calculation Date', width: 14 }
] as const;
const FIGURES: readonly (readonly [string, (row: Balance) => number | null])[] = [
	['Elig.', (row) => row.entitlement],
	['B.F.', (row) => row.brought_forward],
	['Forfeit', (row) => row.expired],
	['Credit', (row) => row.credited],
	// Earned where the grant accrues (released below the year's entitlement); upfront shows 0.
	['Earn', (row) => (row.granted !== row.entitlement ? row.granted : 0)],
	['Total', (row) => row.total],
	['Taken', (row) => row.taken],
	['Bal.', (row) => row.balance]
];

const fill = (argb: string): ExcelJS.FillPattern => ({
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb }
});
const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
const round = (value: number | null) => (value == null ? null : Math.round(value * 100) / 100);

export function leaveBalanceWorkbook(options: {
	readonly company: string;
	readonly asOf: string;
	readonly rows: readonly LeaveBalanceReportRow[];
}): ExcelJS.Workbook {
	// A type with a balance (an unmetered one has none), annual leave first.
	const types = [
		...new Map(
			options.rows
				.flatMap((row) => row.balances)
				.filter((row) => row.balance != null)
				.map((row) => [row.code, row])
		).values()
	].toSorted(
		(a, b) =>
			(a.code.startsWith('ANNUAL') ? 0 : 1) - (b.code.startsWith('ANNUAL') ? 0 : 1) ||
			a.code.localeCompare(b.code)
	);
	const band = 1 + FIGURES.length;
	const notesColumn = IDENTITY.length + types.length * band + 1;
	const width = notesColumn;
	const workbook = new ExcelJSBrowser.Workbook();
	const sheet = workbook.addWorksheet('Leave balances', {
		views: [{ state: 'frozen', xSplit: IDENTITY.length, ySplit: HEADER_ROW, showGridLines: false }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	sheet.columns = [
		...IDENTITY.map((column) => ({ width: column.width })),
		...types.flatMap(() => [{ width: 7 }, ...FIGURES.map(() => ({ width: 9 }))]),
		{ width: 64 }
	];
	const masthead = (row: number, text: string, font: Partial<ExcelJS.Font>) => {
		sheet.mergeCells(row, 1, row, width);
		sheet.getCell(row, 1).value = text;
		sheet.getCell(row, 1).font = font;
	};
	masthead(1, options.company, { bold: true, size: 14, color: { argb: NAVY } });
	masthead(2, 'LEAVE CONSOLIDATE REPORT', { bold: true, color: { argb: NAVY } });
	masthead(3, `As at ${options.asOf.split('-').toReversed().join('-')}`, {
		color: { argb: NAVY }
	});

	const bands = [
		{ title: 'Employee', from: 1, to: IDENTITY.length },
		...types.map((type, index) => ({
			title: type.unit === 'HOUR' ? `${type.name} (hours)` : type.name,
			from: IDENTITY.length + index * band + 1,
			to: IDENTITY.length + (index + 1) * band
		})),
		{ title: 'Report notes', from: notesColumn, to: notesColumn }
	];
	for (const { title, from, to } of bands) {
		if (from !== to) sheet.mergeCells(FIRST_BAND_ROW, from, FIRST_BAND_ROW, to);
		sheet.getCell(FIRST_BAND_ROW, from).value = title;
		for (let column = from; column <= to; column += 1) {
			const cell = sheet.getCell(FIRST_BAND_ROW, column);
			cell.fill = fill(LIGHT_BLUE);
			cell.font = { bold: true, color: { argb: NAVY } };
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			cell.border = { top: THIN, bottom: THIN, right: THIN };
		}
	}
	const header = sheet.getRow(HEADER_ROW);
	header.height = 32;
	header.values = [
		...IDENTITY.map((column) => column.header),
		...types.flatMap(() => ['Year', ...FIGURES.map(([label]) => label)]),
		'Report notes'
	];
	header.eachCell((cell, column) => {
		cell.fill = fill(NAVY);
		cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		cell.alignment = {
			horizontal: column > IDENTITY.length ? 'right' : 'left',
			vertical: 'middle',
			wrapText: true
		};
		cell.border = { right: THIN };
	});

	for (const person of options.rows) {
		const row = sheet.addRow([
			person.employee_number,
			person.name,
			day(person.service_start),
			...types.flatMap((type) => {
				const balance = person.balances.find((row) => row.code === type.code);
				return balance == null
					? Array.from({ length: band }, () => null)
					: [
							new Date(`${balance.window.start.slice(0, 10)}T00:00:00Z`).getUTCFullYear(),
							...FIGURES.map(([, value]) => round(value(balance)))
						];
			}),
			[
				person.issue,
				...person.balances.flatMap((balance) =>
					(balance.warnings ?? []).map((warning) => `${balance.name}: ${warning}`)
				)
			]
				.filter(Boolean)
				.join('\n') || null
		]);
		for (let column = 1; column <= width; column += 1) {
			const cell = row.getCell(column);
			cell.border = { bottom: THIN, right: THIN };
			if (column === notesColumn) cell.alignment = { vertical: 'top', wrapText: true };
			else if (column === IDENTITY.length) cell.numFmt = DAY;
			else if (column > IDENTITY.length && (column - IDENTITY.length - 1) % band !== 0)
				cell.numFmt = '0.00';
		}
	}
	return workbook;
}
