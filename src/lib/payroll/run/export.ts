/**
 * Artefacts a settled run produces: the payroll workbook, the bank file and the payslips.
 *
 * None of this is stored. A payslip is its lines and its charges; a workbook is a view of them.
 */

import type ExcelJS from 'exceljs';
import { Effect, Number as EffectNumber } from 'effect';
import {
	bySchemeListing,
	schemeGroup,
	schemeLabel,
	type SchemeListing
} from '../../../lib/payroll/scheme-label.js';
import {
	outputGroups,
	workbookRows,
	type ReportContribution,
	type ReportLine,
	type ReportPayslip,
	catalogueGroups,
	catalogueRows
} from './report.js';
import * as Predicate from 'effect/Predicate';
import { INCENTIVE_LINE, OVERTIME_LINE } from '../work-bands.js';

const IDENTITY_COLUMNS = [
	{ header: 'Employee number', key: 'employee_number', width: 20 },
	{ header: 'Name', key: 'employee_name', width: 32 },
	{ header: 'Currency', key: 'currency', width: 12 }
] as const;

const IDENTITY_SECTION_NAME = 'Identity';

const SECTION_COLOURS: Record<string, string> = {
	Identity: 'FFEDECE6',
	'Earnings & absence': 'FFE8F5E9',
	Gross: 'FFDCEDC8',
	'Post-gross payments & deductions': 'FFE0F7FA',
	Net: 'FFE3F2FD',
	Statutory: 'FFFFEBEE',
	Attendance: 'FFFFF3E0',
	Other: 'FFF5F5F5'
};

const SECTION_BAND_ROW = 1;
const HEADER_ROW = 2;

/** Money on a payslip is cents; a float that drifted a billionth past one is not a payroll figure. */
const cents = (row: Record<string, string | number | null>) =>
	Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key,
			Predicate.isNumber(value) ? Math.round(value * 100) / 100 : value
		])
	);
const NUMERIC_FORMAT = '#,##0.00';
const THIN_BORDER = { style: 'thin', color: { argb: 'FFB8B5A8' } } as const;
const INFOTECH_NAVY = 'FF17365D';
const INFOTECH_LIGHT_BLUE = 'FFD9EAF7';

type WorkbookSheet = {
	/** The worksheet name — one sheet per period. */
	readonly period: string;
	readonly payDate?: string | undefined;
	/** The legal entity's name: the salary listing's masthead. */
	readonly company?: string | undefined;
	readonly payslips: readonly ReportPayslip[];
	/** The run's bank payments, where the export loaded them: the workbook's Bank sheet. */
	readonly bank?:
		| readonly {
				readonly employeeNumber: string;
				readonly currency: string;
				readonly net: number;
				readonly bank: BankAccount;
		  }[]
		| undefined;
};

/**
 * Where a settled line sits on the salary listing and the sign it prints with. A line outside gross
 * and net (an employer cost, an information line) is on the Lines sheet, not here.
 */
const LISTING_PLACE: Readonly<
	Record<string, { readonly afterGross: boolean; readonly sign: 1 | -1 }>
> = {
	EARNING: { afterGross: false, sign: 1 },
	ABSENCE: { afterGross: false, sign: -1 },
	NON_WAGE_PAYMENT: { afterGross: true, sign: 1 },
	DEDUCTION: { afterGross: true, sign: -1 }
};
const LISTING_BUCKETS = ['EARNING', 'ABSENCE', 'NON_WAGE_PAYMENT', 'DEDUCTION'];
/** Pay order inside a bucket; an unranked family follows these, and leave (encashment) comes last. */
const LISTING_FAMILIES = [
	'BASE',
	'ALLOWANCE',
	OVERTIME_LINE,
	INCENTIVE_LINE,
	'WORK_DAY',
	'ADHOC',
	'CLAIM',
	'LOAN_REPAYMENT'
];
const listingRank = (line: ReportLine): number => {
	const key =
		line.family === 'WORK_DAY' &&
		(line.componentCode === OVERTIME_LINE || line.componentCode === INCENTIVE_LINE)
			? line.componentCode
			: line.family;
	const family = LISTING_FAMILIES.indexOf(key);
	return (
		LISTING_BUCKETS.indexOf(line.bucket) * 100 +
		(family !== -1 ? family : line.family === 'LEAVE' ? 99 : 50)
	);
};

type ListingColumn = {
	readonly band: string;
	readonly header: string;
	readonly width: number;
	readonly money: boolean;
	readonly value: (payslip: ReportPayslip) => string | number | Date | null;
};

const LISTING_MONEY = '#,##0.00;-#,##0.00';
const LISTING_DATE = 'yyyy-mm-dd';
const LISTING_HEADER_ROW = 4;
/** Designation through name stay on screen; the rest of the identity block scrolls. */
const LISTING_FROZEN_COLUMNS = 5;
const LISTING_SECTION_INDEX = 1;
const LISTING_NAME_INDEX = 4;

const listingDay = (value: string | null) =>
	value == null || value === '' ? null : new Date(`${value}T00:00:00Z`);
const identity = (header: string, width: number, value: ListingColumn['value']): ListingColumn => ({
	band: 'Employee',
	header,
	width,
	money: false,
	value
});
const money = (band: string, header: string, value: ListingColumn['value']): ListingColumn => ({
	band,
	header,
	width: EffectNumber.clamp({ minimum: 12, maximum: 18 })(header.length + 2),
	money: true,
	value
});

/** The listing's column for a scheme: a scheme folded into a group is headed by that group. */
const listingName = (charge: SchemeListing) =>
	charge.listing_group == null ? schemeLabel(charge) : (charge.label ?? schemeGroup(charge));

/**
 * The salary listing's columns, derived from what these payslips settled: identity, the earnings in
 * pay order down to gross, what is paid or recovered after gross down to net, each share of every
 * scheme charged, each scheme's base, and what the period cost the entity.
 */
function listingColumns(payslips: readonly ReportPayslip[]): ListingColumn[] {
	const lineColumns = (band: string, afterGross: boolean) => {
		const first = new Map<string, ReportLine>();
		for (const line of payslips.flatMap((payslip) => payslip.lines))
			if (LISTING_PLACE[line.bucket]?.afterGross === afterGross && !first.has(line.componentCode))
				first.set(line.componentCode, line);
		return [...first.values()]
			.toSorted(
				(a, b) => listingRank(a) - listingRank(b) || a.componentCode.localeCompare(b.componentCode)
			)
			.map((column) =>
				money(band, column.componentName, (payslip) =>
					payslip.lines.reduce((sum, line) => {
						const place = LISTING_PLACE[line.bucket];
						return line.componentCode === column.componentCode && place?.afterGross === afterGross
							? sum + place.sign * line.amount
							: sum;
					}, 0)
				)
			);
	};
	const charges = payslips.flatMap((payslip) => [...payslip.contributions.values()]);
	const schemes = new Map<string, ReportContribution>();
	for (const charge of charges.toSorted(bySchemeListing))
		if (!schemes.has(schemeGroup(charge))) schemes.set(schemeGroup(charge), charge);
	const charged = (test: (charge: ReportContribution) => boolean) =>
		[...schemes].filter(([group]) =>
			charges.some((charge) => schemeGroup(charge) === group && test(charge))
		);
	const inGroup = (
		payslip: ReportPayslip,
		group: string,
		of: (charge: ReportContribution) => number
	) =>
		[...payslip.contributions.values()]
			.filter((charge) => schemeGroup(charge) === group)
			.reduce((sum, charge) => sum + of(charge), 0);
	const share = (band: string, role: 'employee' | 'employer') =>
		charged((charge) => charge[role] !== 0).map(([group, charge]) =>
			money(band, listingName(charge), (payslip) => inGroup(payslip, group, (c) => c[role]))
		);
	return [
		identity('Designation', 24, (payslip) => payslip.designation),
		identity('Section', 16, (payslip) => payslip.section),
		identity('Group', 12, (payslip) => payslip.group),
		identity('Employee no.', 14, (payslip) => payslip.employeeNumber),
		identity('Name', 32, (payslip) => payslip.employeeName),
		identity('Identity no.', 18, (payslip) => payslip.identityNumber),
		identity('Hire date', 12, (payslip) => listingDay(payslip.hireDate)),
		identity('Last day', 12, (payslip) => listingDay(payslip.lastDay)),
		...lineColumns('Earnings', false),
		money('Gross', 'Gross', (payslip) => payslip.gross),
		...lineColumns('Additions & deductions', true),
		money('Net', 'Net', (payslip) => payslip.net),
		...share('Employee statutory', 'employee'),
		...share('Employer statutory', 'employer'),
		...charged((charge) => charge.employee !== 0 || charge.employer !== 0).map(([group, charge]) =>
			money('Reference bases', `${listingName(charge)} base`, (payslip) =>
				inGroup(payslip, group, (c) => c.base)
			)
		),
		money('Total', 'Total expenses', (payslip) => payslip.gross + employerShare(payslip))
	];
}

/** `2026-01` → `JAN 2026`; a semi-monthly half keeps its part (`JAN 2026 - PART 1`). */
function listingMonth(period: string): string {
	const match = /^(\d{4})-(\d{2})(?:-(\d))?$/.exec(period);
	if (match == null) return period.toUpperCase();
	const month = new Date(`${match[1]}-${match[2]}-01T00:00:00Z`)
		.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
		.toUpperCase();
	return `${month} ${match[1]}${match[3] == null ? '' : ` - PART ${match[3]}`}`;
}

const byListing = (a: ReportPayslip, b: ReportPayslip) =>
	// A person with no recorded section sorts after every section, not before it.
	(a.section == null ? 1 : 0) - (b.section == null ? 1 : 0) ||
	(a.section ?? '').localeCompare(b.section ?? '') ||
	(a.group ?? '').localeCompare(b.group ?? '') ||
	a.employeeNumber.localeCompare(b.employeeNumber);

/**
 * The salary listing: one row per employee by section, then group, a subtotal under each section
 * and a grand total, in the columns `listingColumns` derives. The masthead is the entity and the
 * month, then the column bands, then the headers, all frozen with designation through name.
 */
function addSalaryListingSheet(workbook: ExcelJS.Workbook, sheet: WorkbookSheet): void {
	const columns = listingColumns(sheet.payslips);
	const worksheet = workbook.addWorksheet(`${sheet.period} Salary listing`.slice(0, 31), {
		views: [
			{
				state: 'frozen',
				xSplit: LISTING_FROZEN_COLUMNS,
				ySplit: LISTING_HEADER_ROW,
				showGridLines: false
			}
		],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	worksheet.columns = columns.map((column) => ({ width: column.width }));
	const width = columns.length;
	const masthead = (row: number, text: string, font: Partial<ExcelJS.Font>) => {
		worksheet.mergeCells(row, 1, row, width);
		worksheet.getCell(row, 1).value = text;
		worksheet.getCell(row, 1).font = font;
	};
	masthead(1, sheet.company ?? '', { bold: true, size: 14, color: { argb: INFOTECH_NAVY } });
	masthead(2, `STAFF SALARY LISTING - ${listingMonth(sheet.period)}`, {
		bold: true,
		color: { argb: INFOTECH_NAVY }
	});

	for (let from = 0; from < width;) {
		let to = from;
		while (to + 1 < width && columns[to + 1]!.band === columns[from]!.band) to += 1;
		if (from < to) worksheet.mergeCells(3, from + 1, 3, to + 1);
		worksheet.getCell(3, from + 1).value = columns[from]!.band;
		for (let index = from; index <= to; index += 1) {
			const cell = worksheet.getCell(3, index + 1);
			cell.fill = fill(INFOTECH_LIGHT_BLUE);
			cell.font = { bold: true, color: { argb: INFOTECH_NAVY } };
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
		}
		from = to + 1;
	}
	const header = worksheet.getRow(LISTING_HEADER_ROW);
	header.height = 32;
	for (const [index, column] of columns.entries()) {
		const cell = header.getCell(index + 1);
		cell.value = column.header;
		cell.fill = fill(INFOTECH_NAVY);
		cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		cell.alignment = {
			horizontal: column.money ? 'right' : 'left',
			vertical: 'middle',
			wrapText: true
		};
		cell.border = { right: THIN_BORDER };
	}

	const round = (value: number) => Math.round(value * 100) / 100;
	const formatRow = (row: ExcelJS.Row) => {
		for (const [index, column] of columns.entries()) {
			const cell = row.getCell(index + 1);
			if (column.money) cell.numFmt = LISTING_MONEY;
			else if (cell.value instanceof Date) cell.numFmt = LISTING_DATE;
			cell.border = { bottom: THIN_BORDER, right: THIN_BORDER };
		}
	};
	/** A subtotal over rows `from`–`to`; SUBTOTAL skips the section subtotals inside a grand total's range. */
	const totalRow = (
		label: string,
		section: string | null,
		from: number,
		to: number,
		payslips: readonly ReportPayslip[]
	) => {
		const row = worksheet.addRow(
			columns.map((column, index) => {
				if (!column.money)
					return index === LISTING_NAME_INDEX
						? label
						: index === LISTING_SECTION_INDEX
							? section
							: null;
				const letter = worksheet.getColumn(index + 1).letter;
				return {
					formula: `SUBTOTAL(9,${letter}${from}:${letter}${to})`,
					result: round(
						payslips.reduce((sum, payslip) => sum + round(column.value(payslip) as number), 0)
					)
				};
			})
		);
		formatRow(row);
		row.font = { bold: true, color: { argb: INFOTECH_NAVY } };
		for (let index = 1; index <= width; index += 1) {
			row.getCell(index).fill = fill(INFOTECH_LIGHT_BLUE);
			row.getCell(index).border = { top: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
		}
		return row;
	};

	const sorted = sheet.payslips.toSorted(byListing);
	const firstRow = LISTING_HEADER_ROW + 1;
	for (const [section, members] of Map.groupBy(sorted, (payslip) => payslip.section)) {
		const from = worksheet.rowCount + 1;
		for (const payslip of members)
			formatRow(
				worksheet.addRow(
					columns.map((column) => {
						const value = column.value(payslip);
						return Predicate.isNumber(value) ? round(value) : value;
					})
				)
			);
		totalRow(
			`Subtotal: ${section ?? 'No section'} (${members.length})`,
			section,
			from,
			worksheet.rowCount,
			members
		);
	}
	if (sorted.length > 0) {
		const total = totalRow(`TOTAL (${sorted.length})`, null, firstRow, worksheet.rowCount, sorted);
		total.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		for (let index = 1; index <= width; index += 1) total.getCell(index).fill = fill(INFOTECH_NAVY);
	}
}

/** Paint one section's columns: numeric format where it is not the identity block, its colour, alignment and group level. */
function styleSectionGroup(
	worksheet: ExcelJS.Worksheet,
	groupName: string,
	from: number,
	to: number,
	grouped: number
): void {
	for (let position = from; position <= to; position += 1) {
		const target = worksheet.getColumn(position);
		if (groupName !== IDENTITY_SECTION_NAME) target.numFmt = NUMERIC_FORMAT;
		target.fill = fill(SECTION_COLOURS[groupName] ?? SECTION_COLOURS.Other!);
		target.alignment = { horizontal: groupName === IDENTITY_SECTION_NAME ? 'left' : 'right' };
		if (groupName !== IDENTITY_SECTION_NAME && position <= grouped) target.outlineLevel = 1;
	}
}

/** Paint one section-band row: the merged section label, its colour and its borders. */
function styleSectionBand(
	worksheet: ExcelJS.Worksheet,
	bands: readonly { readonly section: string; readonly from: number; readonly to: number }[]
): void {
	const band = worksheet.getRow(SECTION_BAND_ROW);
	for (const { section, from, to } of bands) {
		// Column A carries the employee number; leaving it blank is what marks this row as not a
		// payslip, so the identity band starts one column in.
		const start = from === 1 ? 2 : from;
		if (start > to) continue;
		band.getCell(start).value = section;
		for (let index = start; index <= to; index += 1) {
			const banded = band.getCell(index);
			banded.fill = fill(SECTION_COLOURS[section] ?? SECTION_COLOURS.Other!);
			banded.border = { top: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
			banded.font = { bold: true, color: { argb: 'FF3B3A31' } };
			banded.alignment = { horizontal: 'center', vertical: 'middle' };
		}
		if (start < to) worksheet.mergeCells(SECTION_BAND_ROW, start, SECTION_BAND_ROW, to);
	}
	band.height = 20;
}

/**
 * The payroll workbook: per period the salary listing, then the Summary, the catalogue matrix (row 1
 * its section band, row 2 one header per output id, which is what machine readers key on), and the
 * Lines, Statutory and Bank sheets.
 */
function buildPayrollWorkbook(excel: Excel, sheets: readonly WorkbookSheet[]): ExcelJS.Workbook {
	const workbook = new excel.Workbook();
	workbook.creator = 'Norbital';
	workbook.subject = 'Payroll calculation report';

	// The salary listing is what the file is opened for, so it is the first sheet of every period.
	for (const sheet of sheets) addSalaryListingSheet(workbook, sheet);
	addSummarySheet(workbook, sheets);
	// The catalogue matrix, one column per component under its code, stays beside it for reconciliation.
	for (const sheet of sheets) addMatrixSheet(workbook, sheet);
	addLinesSheet(workbook, sheets);
	addStatutorySheet(workbook, sheets);
	addBankSheet(workbook, sheets);

	return workbook;
}

type TableColumn = {
	readonly header: string;
	readonly key: string;
	readonly width: number;
	/** Money: two decimals, and summed on the TOTAL row. */
	readonly money?: boolean | undefined;
};

/**
 * One purpose-built sheet: a frozen, filtered header row, money columns formatted, and — where
 * `totals` — a TOTAL row summing every money column over the rows above it.
 */
function addTableSheet(
	workbook: ExcelJS.Workbook,
	name: string,
	columns: readonly TableColumn[],
	rows: readonly Record<string, string | number | null>[],
	totals: boolean
): void {
	const worksheet = workbook.addWorksheet(name.slice(0, 31), {
		views: [{ state: 'frozen', ySplit: 1 }]
	});
	worksheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
	for (const row of rows) worksheet.addRow(cents(row));
	const header = worksheet.getRow(1);
	header.font = { bold: true, color: { argb: 'FFF7F7F4' } };
	header.fill = fill('FF26251E');
	header.height = 22;
	header.alignment = { vertical: 'middle' };
	for (const [index, column] of columns.entries())
		if (column.money === true) {
			worksheet.getColumn(index + 1).numFmt = NUMERIC_FORMAT;
			header.getCell(index + 1).alignment = { vertical: 'middle', horizontal: 'right' };
		}
	worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
	if (!totals || rows.length === 0) return;
	const total = worksheet.addRow({ [columns[0]!.key]: 'TOTAL' });
	total.font = { bold: true };
	for (const [index, column] of columns.entries()) {
		if (column.money !== true) continue;
		const letter = worksheet.getColumn(index + 1).letter;
		total.getCell(index + 1).value = { formula: `SUM(${letter}2:${letter}${rows.length + 1})` };
		total.getCell(index + 1).border = { top: THIN_BORDER };
	}
}

const employeeShare = (payslip: ReportPayslip) =>
	[...payslip.contributions.values()].reduce((sum, charge) => sum + charge.employee, 0);
const employerShare = (payslip: ReportPayslip) =>
	[...payslip.contributions.values()].reduce((sum, charge) => sum + charge.employer, 0);
const sumOf = (payslips: readonly ReportPayslip[], of: (payslip: ReportPayslip) => number) =>
	payslips.reduce((sum, payslip) => sum + of(payslip), 0);

/** Summary: one row per run — headcount, gross, deductions, net, both statutory shares and cost. */
function addSummarySheet(workbook: ExcelJS.Workbook, sheets: readonly WorkbookSheet[]): void {
	addTableSheet(
		workbook,
		'Summary',
		[
			{ header: 'Period', key: 'period', width: 12 },
			{ header: 'Pay date', key: 'pay_date', width: 12 },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Employees', key: 'employees', width: 11 },
			{ header: 'Gross', key: 'gross', width: 16, money: true },
			{ header: 'Deductions', key: 'deductions', width: 16, money: true },
			{ header: 'Net pay', key: 'net', width: 16, money: true },
			{ header: 'Statutory (employee)', key: 'employee', width: 20, money: true },
			{ header: 'Statutory (employer)', key: 'employer', width: 20, money: true },
			{ header: 'Employer cost', key: 'cost', width: 16, money: true }
		],
		sheets.flatMap((sheet) =>
			[...Map.groupBy(sheet.payslips, (payslip) => payslip.currency)].map(
				([currency, payslips]) => ({
					period: sheet.period,
					pay_date: sheet.payDate ?? '',
					currency,
					employees: payslips.length,
					gross: sumOf(payslips, (payslip) => payslip.gross),
					deductions: -sumOf(payslips, (payslip) => payslip.totalDeductions),
					net: sumOf(payslips, (payslip) => payslip.net),
					employee: -sumOf(payslips, employeeShare),
					employer: sumOf(payslips, employerShare),
					cost: sumOf(payslips, (payslip) => payslip.employerCost)
				})
			)
		),
		true
	);
}

/** The payslip view's sections, by the bucket a line settled in, and the sign it prints with. */
const LINE_SECTIONS: Readonly<Record<string, { readonly section: string; readonly sign: 1 | -1 }>> =
	{
		EARNING: { section: 'Earnings', sign: 1 },
		ABSENCE: { section: 'Earnings', sign: -1 },
		DEDUCTION: { section: 'Deductions', sign: -1 },
		NON_WAGE_PAYMENT: { section: 'Reimbursements', sign: 1 },
		EMPLOYER_COST: { section: 'Employer contributions', sign: 1 },
		INFORMATION: { section: 'Information', sign: 1 }
	};

/** Lines: every payslip line of every employee, one row each, signed as the payslip prints it. */
function addLinesSheet(workbook: ExcelJS.Workbook, sheets: readonly WorkbookSheet[]): void {
	const rows = sheets.flatMap((sheet) =>
		sheet.payslips.flatMap((payslip) => {
			const who = {
				period: sheet.period,
				employee_number: payslip.employeeNumber,
				employee_name: payslip.employeeName,
				currency: payslip.currency
			};
			const schemes = [...payslip.contributions.values()].toSorted(bySchemeListing);
			return [
				...groupedLines(payslip).map((line) => {
					const place = LINE_SECTIONS[line.bucket] ?? LINE_SECTIONS.INFORMATION!;
					return {
						...who,
						section: place.section,
						line: lineName(line),
						detail: line.detail ?? '',
						quantity: line.quantity,
						amount: place.sign * line.amount
					};
				}),
				...schemes.flatMap((charge) =>
					charge.employee === 0
						? []
						: [
								{
									...who,
									section: 'Deductions',
									line: schemeLabel(charge),
									detail: '',
									quantity: null,
									amount: -charge.employee
								}
							]
				),
				...schemes.flatMap((charge) =>
					charge.employer === 0
						? []
						: [
								{
									...who,
									section: 'Employer contributions',
									line: schemeLabel(charge),
									detail: '',
									quantity: null,
									amount: charge.employer
								}
							]
				)
			];
		})
	);
	addTableSheet(
		workbook,
		'Lines',
		[
			{ header: 'Period', key: 'period', width: 12 },
			{ header: 'Employee number', key: 'employee_number', width: 18 },
			{ header: 'Name', key: 'employee_name', width: 30 },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Section', key: 'section', width: 24 },
			{ header: 'Line', key: 'line', width: 32 },
			{ header: 'Working', key: 'detail', width: 22 },
			{ header: 'Quantity', key: 'quantity', width: 11 },
			{ header: 'Amount', key: 'amount', width: 16, money: true }
		],
		rows,
		false
	);
}

/** Statutory: one row per period and scheme — headcount, wage base, both shares and their sum. */
function addStatutorySheet(workbook: ExcelJS.Workbook, sheets: readonly WorkbookSheet[]): void {
	const rows = sheets.flatMap((sheet) => {
		type Total = {
			readonly charge: ReportContribution;
			readonly currency: string;
			readonly employees: number;
			readonly base: number;
			readonly employee: number;
			readonly employer: number;
		};
		const byScheme = new Map<string, Total>();
		for (const payslip of sheet.payslips)
			for (const charge of payslip.contributions.values()) {
				if (charge.employee === 0 && charge.employer === 0) continue;
				const key = `${payslip.currency}\u0000${charge.scheme_code}`;
				const found = byScheme.get(key) ?? {
					charge,
					currency: payslip.currency,
					employees: 0,
					base: 0,
					employee: 0,
					employer: 0
				};
				byScheme.set(key, {
					...found,
					employees: found.employees + 1,
					base: found.base + charge.base,
					employee: found.employee + charge.employee,
					employer: found.employer + charge.employer
				});
			}
		return [...byScheme.values()]
			.toSorted((a, b) => bySchemeListing(a.charge, b.charge))
			.map((entry) => ({
				period: sheet.period,
				scheme: schemeLabel(entry.charge),
				currency: entry.currency,
				employees: entry.employees,
				base: entry.base,
				employee: entry.employee,
				employer: entry.employer,
				total: entry.employee + entry.employer
			}));
	});
	addTableSheet(
		workbook,
		'Statutory',
		[
			{ header: 'Period', key: 'period', width: 12 },
			{ header: 'Scheme', key: 'scheme', width: 28 },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Employees', key: 'employees', width: 11 },
			{ header: 'Wage base', key: 'base', width: 16, money: true },
			{ header: 'Employee', key: 'employee', width: 16, money: true },
			{ header: 'Employer', key: 'employer', width: 16, money: true },
			{ header: 'Total', key: 'total', width: 16, money: true }
		],
		rows,
		true
	);
}

/** Bank: the payments the bank file carries, one per paid payslip with a destination. */
function addBankSheet(workbook: ExcelJS.Workbook, sheets: readonly WorkbookSheet[]): void {
	const rows = sheets.flatMap((sheet) =>
		(sheet.bank ?? []).map((payment) => ({
			period: sheet.period,
			pay_date: sheet.payDate ?? '',
			employee_number: payment.employeeNumber,
			beneficiary: payment.bank.account_name,
			bank: payment.bank.bank_name,
			bank_code: payment.bank.bank_code,
			account_number: payment.bank.account_number,
			currency: payment.currency,
			amount: payment.net,
			reference: `${sheet.period}-${payment.employeeNumber}`
		}))
	);
	if (rows.length === 0) return;
	addTableSheet(
		workbook,
		'Bank',
		[
			{ header: 'Period', key: 'period', width: 12 },
			{ header: 'Pay date', key: 'pay_date', width: 12 },
			{ header: 'Employee number', key: 'employee_number', width: 18 },
			{ header: 'Beneficiary', key: 'beneficiary', width: 30 },
			{ header: 'Bank', key: 'bank', width: 24 },
			{ header: 'Bank code', key: 'bank_code', width: 14 },
			{ header: 'Account number', key: 'account_number', width: 20 },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Amount', key: 'amount', width: 16, money: true },
			{ header: 'Reference', key: 'reference', width: 22 }
		],
		rows,
		true
	);
}

/**
 * One period's matrix worksheet: an identity block, one column per output id in the order the
 * customer's own workbook reads, and two frozen masthead rows (headers, then the section band).
 */
function addPeriodSheet(
	workbook: ExcelJS.Workbook,
	sheet: WorkbookSheet,
	rows: readonly Record<string, string | number | null>[],
	groups: readonly { readonly name: string; readonly outputIds: readonly string[] }[]
): ExcelJS.Worksheet {
	const worksheet = workbook.addWorksheet(sheet.period, {
		// The identity block and the two masthead rows stay put when the reader scrolls into the
		// statutory columns: a number no one can put a name to is worthless.
		views: [{ state: 'frozen', xSplit: IDENTITY_COLUMNS.length, ySplit: HEADER_ROW }]
	});
	worksheet.properties.defaultRowHeight = 20;
	// A collapsed column group summarises into the column on its right — which is what makes
	// collapsing Earnings leave Gross showing, and collapsing the post-gross block leave Net.
	worksheet.properties.outlineProperties = { summaryBelow: false, summaryRight: true };
	worksheet.columns = [
		...IDENTITY_COLUMNS,
		...groups.flatMap((group) =>
			group.outputIds.map((outputId) => ({
				header: outputId,
				key: outputId,
				width: EffectNumber.clamp({ minimum: 13, maximum: 28 })(outputId.length + 3)
			}))
		)
	];

	// Column styling first: exceljs pushes a column style onto the cells that exist, so the
	// masthead rows are styled after this, and the data rows inherit it as they are added.
	let column = IDENTITY_COLUMNS.length + 1;
	const bands: { readonly section: string; readonly from: number; readonly to: number }[] = [
		{ section: IDENTITY_SECTION_NAME, from: 1, to: IDENTITY_COLUMNS.length }
	];
	for (const [index, group] of groups.entries()) {
		const from = column;
		const to = column + group.outputIds.length - 1;
		// Excel ends a column group at the first column left outside it, and shows that column as
		// the group's summary. A one-column section — Gross, Net — is exactly that summary, so it
		// stays outside every group and the band to its left collapses into it. A section that is
		// not followed by such a summary keeps its own last column out of the group instead, or
		// it would run into the next section and the two would collapse as one.
		const next = groups[index + 1];
		const grouped =
			group.outputIds.length === 1
				? from - 1
				: next == null || next.outputIds.length > 1
					? to - 1
					: to;
		styleSectionGroup(worksheet, group.name, from, to, grouped);
		bands.push({ section: group.name, from, to });
		column = to + 1;
	}

	for (const [index, payslip] of sheet.payslips.entries())
		worksheet.addRow(
			cents({
				employee_number: payslip.employeeNumber,
				employee_name: payslip.employeeName,
				currency: payslip.currency,
				...rows[index]
			})
		);
	// `columns` wrote the headers on row 1. The band goes above them, so everything moves down one.
	worksheet.insertRow(SECTION_BAND_ROW, []);
	styleSectionBand(worksheet, bands);

	const header = worksheet.getRow(HEADER_ROW);
	header.font = { bold: true, color: { argb: 'FFF7F7F4' } };
	header.fill = fill('FF26251E');
	header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
	header.height = 22;
	worksheet.autoFilter = {
		from: { row: HEADER_ROW, column: 1 },
		to: { row: HEADER_ROW, column: worksheet.columnCount }
	};
	return worksheet;
}

/**
 * The catalogue-entries workbook: one sheet per period of allowances, claims and loans per
 * employee, a per-row roll-up, and a SUM row under every money column. The payroll workbook
 * minus salary, absence and statute.
 */
function buildCatalogueWorkbook(excel: Excel, sheets: readonly WorkbookSheet[]): ExcelJS.Workbook {
	const workbook = new excel.Workbook();
	workbook.creator = 'Norbital';
	workbook.subject = 'Catalogue entries report';
	for (const sheet of sheets) {
		const groups = catalogueGroups(sheet.payslips);
		if (groups.length === 0) continue;
		const rows = catalogueRows(sheet.payslips, groups);
		const worksheet = addPeriodSheet(workbook, sheet, rows, groups);
		const firstDataRow = HEADER_ROW + 1;
		const lastDataRow = HEADER_ROW + rows.length;
		const total = worksheet.addRow({ employee_number: 'TOTAL' });
		total.font = { bold: true };
		for (
			let position = IDENTITY_COLUMNS.length + 1;
			position <= worksheet.columnCount;
			position += 1
		) {
			const letter = worksheet.getColumn(position).letter;
			total.getCell(position).value = {
				formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`
			};
		}
	}
	return workbook;
}

/** Whether the selected runs settled any catalogue entry at all; an empty workbook is not offered. */
export function hasCatalogueEntries(sheets: readonly WorkbookSheet[]): boolean {
	return sheets.some((sheet) => catalogueGroups(sheet.payslips).length > 0);
}

/** The catalogue-entries workbook, as the bytes a download expects. */
export function catalogueEntriesXlsx(sheets: readonly WorkbookSheet[]) {
	return xlsxBytes((excel) => buildCatalogueWorkbook(excel, sheets));
}

/**
 * The generic one-sheet-per-period export for a jurisdiction with no workbook of its own.
 *
 * Squared off across the sheet: a scheme this population runs but did not charge one person must
 * read as an explicit zero on that person's row, not as an unwritten cell.
 */
function addMatrixSheet(workbook: ExcelJS.Workbook, sheet: WorkbookSheet): void {
	const rows = workbookRows(sheet.payslips);
	addPeriodSheet(workbook, sheet, rows, outputGroups(sheet.payslips, rows));
}

/**
 * The payroll workbook, as the bytes a download expects.
 *
 * The workbook is built by the imperative library — exceljs — and Effect wraps the two things that
 * actually fail: the build and the serialization. The only promise in the module is this adapter's.
 */
export function payrollReportXlsx(sheets: readonly WorkbookSheet[]) {
	return xlsxBytes((excel) => buildPayrollWorkbook(excel, sheets));
}

/** A declared return's records as one plain sheet, cell for cell. */
export function tableXlsx(name: string, table: readonly (readonly (string | number)[])[]) {
	return xlsxBytes((excel) => {
		const workbook = new excel.Workbook();
		workbook.addWorksheet(name.slice(0, 31)).addRows(table.map((row) => [...row]));
		return workbook;
	});
}

type Excel = typeof import('exceljs/dist/exceljs.bare.min.js').default;

/**
 * A built workbook as the bytes a download expects; the build and the serialisation are what fail.
 * exceljs is imported on demand: evaluating it costs every guest invocation ~50 ms of CPU, and only
 * an export uses it.
 */
function xlsxBytes(build: (excel: Excel) => ExcelJS.Workbook) {
	return Effect.tryPromise(() => import('exceljs/dist/exceljs.bare.min.js')).pipe(
		Effect.flatMap(({ default: excel }) =>
			Effect.try({ try: () => build(excel), catch: (error) => error })
		),
		Effect.flatMap((workbook) => Effect.tryPromise(() => workbook.xlsx.writeBuffer())),
		Effect.map((bytes) => [...new Uint8Array(bytes)])
	);
}

function fill(argb: string): ExcelJS.FillPattern {
	return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

type BankAccount = {
	readonly account_name: string;
	readonly bank_code: string;
	readonly bank_name: string;
	readonly account_number: string;
};

type BankPayment = {
	/** The run's period: with the employee number, the payment's reference. */
	readonly period: string;
	readonly paymentDate: string;
	readonly employeeNumber: string;
	readonly currency: string;
	readonly net: number;
	readonly bank: BankAccount;
};

/** The bank file: one payment row per payslip that has a destination. */
export function bankFileRows(payments: readonly BankPayment[]): (string | number)[][] {
	return [
		[
			'record_type',
			'payment_date',
			'employee_number',
			'beneficiary_name',
			'bank_code',
			'bank_name',
			'account_number',
			'amount',
			'currency',
			'reference'
		],
		...payments.map((payment) => [
			'PAYMENT',
			payment.paymentDate,
			payment.employeeNumber,
			payment.bank.account_name,
			payment.bank.bank_code,
			payment.bank.bank_name,
			payment.bank.account_number,
			payment.net.toFixed(2),
			payment.currency,
			`${payment.period}-${payment.employeeNumber}`
		])
	];
}

function pdfText(value: string): string {
	return value
		.normalize('NFKD')
		.replaceAll(/[^\x20-\x7e]/g, '?')
		.replaceAll('\\', '\\\\')
		.replaceAll('(', '\\(')
		.replaceAll(')', '\\)');
}

/** A minimal, dependency-free text PDF. */
function textPdf(lines: readonly string[]): string {
	const chunks = Array.from({ length: Math.max(1, Math.ceil(lines.length / 52)) }, (_, index) =>
		lines.slice(index * 52, (index + 1) * 52)
	);
	const fontId = 3 + chunks.length * 2;
	const objectBodies = new Map<number, string>();
	objectBodies.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
	objectBodies.set(
		2,
		`<< /Type /Pages /Kids [${chunks.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${chunks.length} >>`
	);
	for (const [index, chunk] of chunks.entries()) {
		const pageId = 3 + index * 2;
		const streamId = pageId + 1;
		const stream = `BT\n/F1 9 Tf\n48 760 Td\n12 TL\n${chunk.map((line) => `(${pdfText(line)}) Tj\nT*`).join('')}ET`;
		objectBodies.set(
			pageId,
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`
		);
		objectBodies.set(streamId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	}
	objectBodies.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

	let body = '%PDF-1.4\n';
	const offsets: number[] = [0];
	for (let id = 1; id <= fontId; id += 1) {
		offsets[id] = body.length;
		body += `${id} 0 obj\n${objectBodies.get(id)}\nendobj\n`;
	}
	const xrefOffset = body.length;
	body += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
	for (let id = 1; id <= fontId; id += 1)
		body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
	return `${body}trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
}

/** Money as a payslip prints it: two decimals, thousands grouped, a real minus. */
const figure = (amount: number) => {
	const text = Math.abs(amount).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	return amount < 0 && Math.round(amount * 100) !== 0 ? `-${text}` : text;
};
const QTY = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** A band's overtime or incentive line: the one family whose quantity is overtime hours. */
const isOvertime = (line: ReportLine) =>
	line.family === 'WORK_DAY' &&
	(line.componentCode === OVERTIME_LINE || line.componentCode === INCENTIVE_LINE);

type DayRange = { readonly start: string; readonly end: string };

/** The payslip's name for a line: its catalogue name, and the band it was priced on where it has one. */
export const lineName = (line: ReportLine) =>
	`${line.componentName}${line.label && line.label !== line.componentCode && line.label !== line.componentName ? ` ${line.label}` : ''}`;

/**
 * A payslip's lines as a reader adds them up: one per bucket and name, amounts and quantities
 * summed (thirty-one unpaid days are one line of 31), in settlement order.
 */
export function groupedLines(payslip: ReportPayslip): readonly ReportLine[] {
	const groups = new Map<string, ReportLine>();
	for (const line of payslip.lines) {
		const key = `${line.bucket}\u0000${lineName(line)}`;
		const found = groups.get(key);
		groups.set(
			key,
			found == null
				? line
				: {
						...found,
						amount: found.amount + line.amount,
						quantity:
							found.quantity == null && line.quantity == null
								? null
								: (found.quantity ?? 0) + (line.quantity ?? 0)
					}
		);
	}
	return [...groups.values()];
}

const WIDTH = 78;
const row = (label: string, detail: string, amount: string) =>
	`  ${label.slice(0, 38).padEnd(38)} ${detail.slice(0, 22).padStart(22)} ${amount.padStart(14)}`;
const total = (label: string, amount: string) =>
	`${label.padEnd(WIDTH - 15)}${amount.padStart(15)}`;
const rule = '-'.repeat(WIDTH);

/**
 * One payslip, as a page, in the payslip view's sections: Earnings → Gross, Deductions (employee
 * statutory shares, then recoveries) → Total deductions, Reimbursements → Net pay, Employer
 * contributions → Employer cost. It carries the particulars an itemised pay slip states (EA 1968
 * s.96; S 148/2016 reg.9, Third Schedule items 1, 3–11): employer and employee names, the salary
 * period's first and last days, every line itemised with deductions signed, overtime hours and pay,
 * the overtime period where it differs from the salary period, net pay and the date it is paid.
 */
export function payslipPdf(options: {
	readonly employer: string;
	readonly period: string;
	readonly salaryPeriod: DayRange;
	readonly overtimePeriod: DayRange;
	readonly payDate: string;
	readonly payslip: ReportPayslip;
}): string {
	const { payslip } = options;
	const money = (amount: number) => `${figure(amount)} ${payslip.currency}`;
	const lines = (bucket: string, sign: 1 | -1) =>
		groupedLines(payslip)
			.filter((line) => line.bucket === bucket)
			.map((line) =>
				row(
					lineName(line),
					line.detail ?? (line.quantity == null ? '' : QTY(line.quantity)),
					figure(sign * line.amount)
				)
			);
	const section = (title: string, body: readonly string[], closing?: string) =>
		body.length === 0 && closing == null
			? []
			: ['', title, ...body, ...(closing == null ? [] : [rule, closing])];
	const schemes = [...payslip.contributions.values()].toSorted(bySchemeListing);
	const overtime = payslip.lines.filter(isOvertime);
	const differs =
		options.overtimePeriod.start !== options.salaryPeriod.start ||
		options.overtimePeriod.end !== options.salaryPeriod.end;
	return textPdf([
		'PAYSLIP',
		rule,
		`Employer: ${options.employer}`,
		`Employee: ${payslip.employeeName} (${payslip.employeeNumber})`,
		...(payslip.designation == null ? [] : [`Designation: ${payslip.designation}`]),
		`Period: ${options.period}`,
		`Salary period: ${options.salaryPeriod.start} to ${options.salaryPeriod.end}`,
		`Pay date: ${options.payDate}`,
		`Currency: ${payslip.currency}`,
		...section(
			'EARNINGS',
			[...lines('EARNING', 1), ...lines('ABSENCE', -1)],
			total('Gross', figure(payslip.gross))
		),
		...section(
			'DEDUCTIONS',
			[
				...schemes
					.filter((amounts) => amounts.employee !== 0)
					.map((amounts) =>
						row(schemeLabel(amounts), `on ${figure(amounts.base)}`, figure(-amounts.employee))
					),
				...lines('DEDUCTION', -1)
			],
			total('Total deductions', figure(-payslip.totalDeductions))
		),
		...section('REIMBURSEMENTS', lines('NON_WAGE_PAYMENT', 1)),
		'',
		rule,
		total('Net pay', money(payslip.net)),
		`Paid ${options.payDate}`,
		rule,
		...section(
			'EMPLOYER CONTRIBUTIONS (not deducted)',
			[
				...schemes
					.filter((amounts) => amounts.employer !== 0)
					.map((amounts) =>
						row(schemeLabel(amounts), `on ${figure(amounts.base)}`, figure(amounts.employer))
					),
				...lines('EMPLOYER_COST', 1)
			],
			total('Employer cost', money(payslip.employerCost))
		),
		...section('INFORMATION', lines('INFORMATION', 1)),
		...(overtime.length === 0
			? []
			: [
					'',
					...(differs
						? [`Overtime period: ${options.overtimePeriod.start} to ${options.overtimePeriod.end}`]
						: []),
					`Overtime hours: ${overtime.reduce((sum, line) => sum + (line.quantity ?? 0), 0).toFixed(2)}`,
					`Overtime pay: ${money(overtime.reduce((sum, line) => sum + line.amount, 0))} paid ${options.payDate}`
				]),
		...(payslip.unfundedContributions > 0
			? [
					'',
					`Contribution shortfall: ${money(payslip.unfundedContributions)}`,
					`Funding received: ${money(payslip.fundingReceived)}`,
					`Funding outstanding: ${money(Math.max(0, payslip.unfundedContributions - payslip.fundingReceived))}`
				]
			: [])
	]);
}
