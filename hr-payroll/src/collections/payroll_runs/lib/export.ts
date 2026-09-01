/**
 * Artefacts a settled run produces: the payroll workbook, the bank file and the payslips.
 *
 * None of this is stored. A payslip is its lines and its charges; a workbook is a view of them.
 */

import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type ExcelJS from 'exceljs';
import { Effect, Number as EffectNumber, Schema } from 'effect';
import {
	VENDOR_WORKBOOK_COLUMNS,
	VENDOR_WORKBOOK_SECTIONS,
	vendorWorkbookRow,
	outputGroups,
	workbookRows,
	type ReportPayslip
} from './report.js';

const IDENTITY_COLUMNS = [
	{ header: 'Employee number', key: 'employee_number', width: 20 },
	{ header: 'Employment ID', key: 'employment_id', width: 38 },
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
	'Totals & bases': 'FFF3E5F5',
	Attendance: 'FFFFF3E0',
	Other: 'FFF5F5F5'
};

const HEADER_ROW = 1;
const SECTION_BAND_ROW = 2;
const NUMERIC_FORMAT = '#,##0.00';
const THIN_BORDER = { style: 'thin', color: { argb: 'FFB8B5A8' } } as const;
const INFOTECH_NAVY = 'FF17365D';
const INFOTECH_LIGHT_BLUE = 'FFD9EAF7';

const HUMAN_HEADERS: Readonly<Record<string, string>> = {
	eid: 'Employee ID',
	ic_no: 'Identification No.',
	basic_salary: 'Basic Salary',
	gross_salary: 'Gross Salary',
	net_salary: 'Net Salary',
	incentive_ot: 'OT Incentive',
	loan_recovery: 'Loan Recovery',
	epf_employee: 'EPF (Employee)',
	epf_employer: 'EPF (Employer)',
	socso_employee: 'SOCSO (Employee)',
	socso_employer: 'SOCSO (Employer)',
	eis_employee: 'EIS (Employee)',
	eis_employer: 'EIS (Employer)',
	tax_employee: 'PCB / Tax',
	// Spelled out because the id cannot be: `15x` beside `1x`, `2x` and `3x` reads as fifteen times
	// the rate on a document a payroll clerk signs off. It means one and a half.
	att_ot_15x_hours: 'ATT OT 1.5X Hours',
	att_normal_hours: 'Normal Hours',
	att_actual_hours: 'Actual Hours',
	att_shift_codes: 'Shift Codes'
};

/**
 * The tokens that are acronyms rather than words, named rather than guessed at by length.
 *
 * The fallback used to uppercase any word of three letters or fewer, on the theory that short
 * tokens are acronyms. `pay`, `day` and `no` are three letters and are not, so the salary listing a
 * payroll clerk reads printed `Back PAY Bonus`, `NO PAY Leave` and `Last DAY`. Length cannot tell
 * `pcb` from `pay`; only a list can, so this is the list.
 *
 * A token ending in `x` after digits — `1x`, `2x` — is an overtime multiple and stays uppercase, so
 * `att_ot_1x_hours` still reads `ATT OT 1X Hours` as the customer's workbook has it.
 */
const HEADER_ACRONYMS: ReadonlySet<string> = new Set([
	'att',
	'aws',
	'cp38',
	'cpf',
	'ee',
	'eid',
	'eis',
	'epf',
	'fw',
	'hrdf',
	'ic',
	'npl',
	'ot',
	'pcb',
	'sdl',
	'socso'
]);

const OVERTIME_MULTIPLE = /^\d+x$/;

function humanHeader(outputId: string): string {
	return (
		HUMAN_HEADERS[outputId] ??
		outputId
			.split('_')
			.map((word) =>
				HEADER_ACRONYMS.has(word) || OVERTIME_MULTIPLE.test(word)
					? word.toUpperCase()
					: `${word[0]!.toUpperCase()}${word.slice(1)}`
			)
			.join(' ')
	);
}

type WorkbookSheet = {
	/** The worksheet name — one sheet per period. */
	readonly period: string;
	readonly payDate?: string;
	readonly payslips: readonly ReportPayslip[];
};

/**
 * The payroll workbook: one worksheet per period, an identity block, then one column per output id
 * in the order the customer's own workbook reads — earnings and absence, gross, what is paid or
 * recovered after gross, net, the statutory charges, the totals and their bases, attendance.
 */
/**
 * The one vendor-shaped sheet: the salary listing with its own masthead rows, section band and freeze.
 *
 * This layout is the customer's own workbook, kept as its own entry so the generic matrix below
 * stays a single-layout function — the band places the header row differently and the identity
 * block is eight columns wide.
 */
function vendorSalaryListingSheet(
	workbook: ExcelJS.Workbook,
	sheet: WorkbookSheet,
	rows: readonly Record<string, string | number | null>[]
): void {
	const identityColumnCount = 8;
	const cleanName = `${sheet.period} Salary Listing`.slice(0, 31);
	const clean = workbook.addWorksheet(cleanName, {
		views: [{ state: 'frozen', xSplit: identityColumnCount, ySplit: 5 }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	clean.properties.defaultRowHeight = 20;
	clean.columns = VENDOR_WORKBOOK_COLUMNS.map((outputId) => ({
		key: outputId,
		width: EffectNumber.clamp({ minimum: 12, maximum: 24 })(humanHeader(outputId).length + 2)
	}));
	clean.mergeCells(1, 1, 1, VENDOR_WORKBOOK_COLUMNS.length);
	clean.getCell(1, 1).value = 'SALARY LISTING';
	clean.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
	clean.getCell(1, 1).fill = fill(INFOTECH_NAVY);
	clean.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
	clean.getRow(1).height = 28;
	clean.mergeCells(2, 1, 2, VENDOR_WORKBOOK_COLUMNS.length);
	clean.getCell(2, 1).value =
		`Salary month: ${sheet.period}${sheet.payDate ? `   ·   Pay date: ${sheet.payDate}` : ''}`;
	clean.getCell(2, 1).font = { bold: true, color: { argb: INFOTECH_NAVY } };
	clean.getCell(2, 1).alignment = { horizontal: 'center' };

	let cleanColumn = 1;
	for (const group of VENDOR_WORKBOOK_SECTIONS) {
		const from = cleanColumn;
		const to = from + group.outputIds.length - 1;
		clean.getCell(4, from).value = group.name;
		if (from < to) clean.mergeCells(4, from, 4, to);
		for (let position = from; position <= to; position += 1) {
			const cell = clean.getCell(4, position);
			cell.fill = fill(INFOTECH_LIGHT_BLUE);
			cell.font = { bold: true, color: { argb: INFOTECH_NAVY } };
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
		}
		cleanColumn = to + 1;
	}
	for (const [index, outputId] of VENDOR_WORKBOOK_COLUMNS.entries()) {
		const cell = clean.getCell(5, index + 1);
		cell.value = humanHeader(outputId);
		cell.fill = fill(INFOTECH_NAVY);
		cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
	}
	clean.getRow(5).height = 34;
	for (const row of rows) clean.addRow(row);
	const firstDataRow = 6;
	const lastDataRow = firstDataRow + rows.length - 1;
	if (rows.length > 0) {
		const total = clean.addRow({ eid: 'TOTAL' });
		total.font = { bold: true, color: { argb: INFOTECH_NAVY } };
		total.fill = fill(INFOTECH_LIGHT_BLUE);
		for (let position = identityColumnCount + 1; position <= clean.columnCount; position += 1) {
			const outputId = VENDOR_WORKBOOK_COLUMNS[position - 1]!;
			if (outputId === 'remark' || outputId === 'att_shift_codes') continue;
			total.getCell(position).value = {
				formula: `SUM(${clean.getColumn(position).letter}${firstDataRow}:${clean.getColumn(position).letter}${lastDataRow})`
			};
		}
	}
	for (let rowNumber = firstDataRow; rowNumber <= clean.rowCount; rowNumber += 1) {
		const dataRow = clean.getRow(rowNumber);
		for (let position = 1; position <= clean.columnCount; position += 1) {
			const cell = dataRow.getCell(position);
			cell.border = { bottom: THIN_BORDER, right: THIN_BORDER };
			if (position > identityColumnCount && typeof cell.value !== 'string')
				cell.numFmt = NUMERIC_FORMAT;
		}
	}
	clean.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: clean.columnCount } };
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
 * The workbook for one export: one matrix worksheet per period, plus the vendor listing where it applies.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE SECTION BAND SITS **BELOW** THE HEADER ROW.
 *
 * A merged band naming each section is what turns 30-odd `camelCase` headers back into a payroll
 * workbook, and in the customer's own file that band is the top row. Here it cannot be: the column
 * headers are the machine-readable contract — the acceptance test and the parity manifests both
 * read row 1 and look up output ids in it — so row 1 belongs to the headers, and the band takes
 * row 2. Both rows are frozen together, so the band travels with the headers and reads as one
 * two-line masthead.
 *
 * The band leaves column A empty on purpose. Every reader of this file that walks rows — the
 * acceptance test included — identifies a payslip row by its employee number, and a blank there is
 * how the band says "I am not a payslip".
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
function buildPayrollWorkbook(sheets: readonly WorkbookSheet[]): ExcelJS.Workbook {
	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'Norbital';
	workbook.subject = 'Payroll calculation report';

	for (const sheet of sheets) {
		if (sheet.payslips.every((payslip) => payslip.currency === 'MYR'))
			addVendorSheet(workbook, sheet);
		else addMatrixSheet(workbook, sheet);
	}

	return workbook;
}

/**
 * One period's matrix worksheet: an identity block, one column per output id in the order the
 * customer's own workbook reads, and two frozen masthead rows (headers, then the section band).
 */
function addPeriodSheet(
	workbook: ExcelJS.Workbook,
	sheet: WorkbookSheet,
	rows: readonly Record<string, string | number | null>[],
	groups: readonly { readonly name: string; readonly outputIds: readonly string[] }[],
	vendor: boolean,
	identityColumnCount: number
): void {
	const worksheet = workbook.addWorksheet(sheet.period, {
		// The identity block and the two masthead rows stay put when the reader scrolls into the
		// statutory columns: a number no one can put a name to is worthless.
		views: [{ state: 'frozen', xSplit: identityColumnCount, ySplit: SECTION_BAND_ROW }]
	});
	if (vendor) worksheet.state = 'veryHidden';
	worksheet.properties.defaultRowHeight = 20;
	// A collapsed column group summarises into the column on its right — which is what makes
	// collapsing Earnings leave Gross showing, and collapsing the post-gross block leave Net.
	worksheet.properties.outlineProperties = { summaryBelow: false, summaryRight: true };
	worksheet.columns = vendor
		? VENDOR_WORKBOOK_COLUMNS.map((outputId) => ({
				header: outputId,
				key: outputId,
				width: EffectNumber.clamp({ minimum: 13, maximum: 28 })(outputId.length + 3)
			}))
		: [
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
	let column = vendor ? 1 : IDENTITY_COLUMNS.length + 1;
	const bands: { readonly section: string; readonly from: number; readonly to: number }[] = vendor
		? []
		: [{ section: IDENTITY_SECTION_NAME, from: 1, to: IDENTITY_COLUMNS.length }];
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

	styleSectionBand(worksheet, bands);

	for (const [index, payslip] of sheet.payslips.entries())
		worksheet.addRow(
			vendor
				? rows[index]
				: {
						employee_number: payslip.employeeNumber,
						employment_id: payslip.employmentId,
						currency: payslip.currency,
						...rows[index]
					}
		);

	const header = worksheet.getRow(HEADER_ROW);
	header.font = { bold: true, color: { argb: 'FFF7F7F4' } };
	header.fill = fill('FF26251E');
	header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
	header.height = 22;
	worksheet.autoFilter = { from: 'A1', to: { row: 1, column: worksheet.columnCount } };
}

/** The customer's own workbook on a period: visible vendor listing plus the hidden matrix behind it. */
function addVendorSheet(workbook: ExcelJS.Workbook, sheet: WorkbookSheet): void {
	const rows = sheet.payslips.map((payslip) => vendorWorkbookRow(payslip));
	vendorSalaryListingSheet(workbook, sheet, rows);
	addPeriodSheet(workbook, sheet, rows, VENDOR_WORKBOOK_SECTIONS, true, 8);
}

/**
 * The generic one-sheet-per-period export for a jurisdiction with no workbook of its own.
 *
 * Squared off across the sheet: a scheme this population runs but did not charge one person must
 * read as an explicit zero on that person's row, not as an unwritten cell.
 */
function addMatrixSheet(workbook: ExcelJS.Workbook, sheet: WorkbookSheet): void {
	const rows = workbookRows(sheet.payslips);
	addPeriodSheet(workbook, sheet, rows, outputGroups(rows), false, IDENTITY_COLUMNS.length);
}

/**
 * The payroll workbook, as the bytes a download expects.
 *
 * The workbook is built by the imperative library — exceljs — and Effect wraps the two things that
 * actually fail: the build and the serialization. The only promise in the module is this adapter's.
 */
export function payrollReportXlsx(sheets: readonly WorkbookSheet[]) {
	return Effect.try({
		try: () => buildPayrollWorkbook(sheets),
		catch: (error) => error
	}).pipe(
		Effect.flatMap((workbook) => Effect.tryPromise(() => workbook.xlsx.writeBuffer())),
		Effect.map((bytes) => [...new Uint8Array(bytes)])
	);
}

function fill(argb: string): ExcelJS.FillPattern {
	return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const BankAccountSchema = Schema.Struct({
	account_name: Schema.String,
	bank_code: Schema.String,
	bank_name: Schema.String,
	account_number: Schema.String
});
const BankPaymentSchema = Schema.Struct({
	payrollRunId: Schema.String,
	paymentDate: Schema.String,
	employeeNumber: Schema.String,
	currency: Schema.String,
	net: Schema.Number,
	bank: BankAccountSchema
});
type BankPayment = Schema.Schema.Type<typeof BankPaymentSchema>;

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
			`${payment.payrollRunId}:${payment.employeeNumber}`
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
	objectBodies.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

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

/** One payslip, as a page. */
export function payslipPdf(options: {
	readonly period: string;
	readonly payDate: string;
	readonly payslip: ReportPayslip;
}): string {
	const { payslip } = options;
	return textPdf([
		'PAYSLIP',
		`Employee: ${payslip.employeeNumber}`,
		`Period: ${options.period}`,
		`Pay date: ${options.payDate}`,
		'',
		'Line | Amount | Currency',
		...payslip.lines.map(
			(line) => `${line.payComponentName} | ` + `${line.amount.toFixed(2)} | ${payslip.currency}`
		),
		'',
		'Statutory | Employee | Employer',
		...[...payslip.contributions].map(
			([code, amounts]) =>
				`${code} | ${amounts.employee.toFixed(2)} | ${amounts.employer.toFixed(2)}`
		),
		'',
		`Gross: ${payslip.gross.toFixed(2)} ${payslip.currency}`,
		`Total deductions: ${payslip.totalDeductions.toFixed(2)} ${payslip.currency}`,
		`Net pay: ${payslip.net.toFixed(2)} ${payslip.currency}`
	]);
}
