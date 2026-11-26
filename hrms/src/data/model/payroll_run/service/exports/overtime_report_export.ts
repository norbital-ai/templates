import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type { JsonObject, Lookup } from '../../../../../lib/contracts.js';
import { lookupOf, settingsConstants } from '../../../../../lib/contracts.js';
import { isJsonObject } from '../../../../../lib/foundation.js';
import { programOf } from '../../../jurisdiction/service/programs.js';
import { enrichWorkDays } from '../engine.js';
import { eligible, evaluateNumber, payBasis, round, type PayrollInput } from '../rates.js';
import {
	boxBorder,
	monthOf,
	solidFill,
	styleDetailSheet,
	styleTotalsRow,
	uniqueSheetName,
	type XlsxWorkbook
} from './xlsx_sheet.js';

/** One evaluated `overtime_catalog` monetary total for one employee in a cutoff period. */
export type OvertimeCatalogLine = {
	readonly code: string;
	readonly label: string;
	readonly amount: number;
};

/** One worked day with overtime, rest/holiday work, or banked time-off hours. */
export type OvertimeDay = {
	readonly date: string;
	readonly dayType: string;
	readonly holiday: string;
	readonly workedHours: number;
	readonly overtimeHours: number;
	readonly bankedHours: number;
};

/** One employee's overtime hours and monetary totals by `overtime_catalog` code. */
export type OvertimePerson = {
	readonly code: string;
	readonly name: string;
	readonly department: string;
	readonly position: string;
	readonly overtimeHours: number;
	readonly bankedHours: number;
	readonly lines: readonly OvertimeCatalogLine[];
	readonly days: readonly OvertimeDay[];
};

/** One period + pay group summary sheet in the overtime report workbook. */
export type OvertimeSheet = {
	readonly company: string;
	readonly currency: string;
	readonly jurisdiction: string;
	readonly period: string;
	readonly payGroup: string;
	readonly attendance: { readonly from: string; readonly to: string };
	readonly people: readonly OvertimePerson[];
};

export interface EmployeeOvertimeInput {
	readonly settings: JsonObject;
	readonly allowance: readonly JsonObject[];
	readonly overtime: readonly JsonObject[];
	readonly employee: JsonObject;
	readonly employment: JsonObject;
	readonly employer: JsonObject;
	readonly coverage: { readonly from: string; readonly to: string };
	readonly period: string;
	readonly payDate: string;
	readonly days: readonly JsonObject[];
	readonly workEvents: readonly JsonObject[];
	readonly holidayNames: ReadonlyMap<string, string>;
}

const roundNum = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/**
 * Evaluates every eligible `overtime_catalog` row's existing `conversion` expression for one person across their
 * attendance cutoff days, using the exact same rate basis and per-rate grouping as `calculatePayroll`.
 */
export const evaluateEmployeeOvertime = (
	input: EmployeeOvertimeInput
): {
	readonly overtimeHours: number;
	readonly bankedHours: number;
	readonly lines: readonly OvertimeCatalogLine[];
	readonly days: readonly OvertimeDay[];
} => {
	const employment: JsonObject =
		typeof input.employment.service_started_on === 'string' &&
		isJsonObject(input.employment.effective_range)
			? {
					...input.employment,
					effective_range: {
						...input.employment.effective_range,
						from: input.employment.service_started_on
					}
				}
			: input.employment;
	const subject = { employee: input.employee, employment, employer: input.employer };
	const run: JsonObject = {
		period: input.period,
		kind: 'REGULAR',
		salary_coverage: input.coverage,
		pay_date: input.payDate
	};
	const basisInput: PayrollInput = {
		run,
		settings: input.settings,
		subtotals: [],
		allowance: input.allowance,
		overtime: input.overtime,
		statutory: [],
		leave_catalog: [],
		claim_catalog: [],
		adhoc_catalog: [],
		loan_catalog: [],
		employee: input.employee,
		employment,
		employer: input.employer,
		balance: {},
		entries: {}
	};
	const basis = payBasis(basisInput, input.coverage);
	const sortedDays = [...input.days].toSorted((a, b) =>
		String(a.date ?? '').localeCompare(String(b.date ?? ''))
	);
	const { days: enrichedDays, wagesByDay } = enrichWorkDays(
		basisInput,
		basis,
		input.coverage,
		sortedDays
	);

	const byRate = Map.groupBy(
		enrichedDays,
		(day) =>
			`${String(day.hour_rate)}/${String(day.day_rate)}/${String(wagesByDay.get(String(day.date ?? '')))}`
	);
	const settingsView: Lookup = settingsConstants(input.settings);
	const roots = programOf('overtime_catalog')?.roots;

	const lines: OvertimeCatalogLine[] = [];
	for (const row of input.overtime) {
		const code = String(row.code ?? '');
		const label = code.replaceAll('_', ' ');
		const context = {
			subject,
			lookup: { ...settingsView, ...lookupOf(row) },
			allowance: input.allowance,
			balances: {},
			base_pay: 0,
			calendar_days: basis.calendar_days,
			working_days: basis.working_days,
			month_wage: basis.month_wage,
			day_rate: basis.day_rate,
			hour_rate: basis.overtime_hour_rate,
			paid_share: 1,
			proration_amount: 0,
			abs_amount: 0,
			leave: [],
			work: { days: enrichedDays },
			work_events: input.workEvents,
			run,
			as_of: input.coverage.to,
			subtotals: {}
		};
		if (!eligible(row.eligibility, context, `${code}.eligibility`, roots)) continue;
		const value =
			byRate.size === 0
				? evaluateNumber(row.conversion, context, `${code}.conversion`, roots)
				: [...byRate.values()].reduce((total, groupDays) => {
						const [first] = groupDays;
						return (
							total +
							evaluateNumber(
								row.conversion,
								{
									...context,
									hour_rate: Number(first?.hour_rate),
									day_rate: Number(first?.day_rate),
									month_wage: wagesByDay.get(String(first?.date ?? '')) ?? basis.month_wage,
									work: { days: groupDays }
								},
								`${code}.conversion`,
								roots
							)
						);
					}, 0);
		const rounded = round(input.settings, value);
		if (rounded === 0) continue;
		const signed = row.direction === 'DEDUCT' ? -Math.abs(rounded) : rounded;
		lines.push({ code, label, amount: signed });
	}

	let overtimeHours = 0;
	let bankedHours = 0;
	const detailDays: OvertimeDay[] = [];
	for (const day of enrichedDays) {
		const date = String(day.date ?? '');
		const dayType = typeof day.day_type === 'string' ? day.day_type : '';
		const holidayKind = typeof day.holiday_kind === 'string' ? day.holiday_kind : '';
		const holiday = input.holidayNames.get(date) ?? holidayKind;
		const workedHours = roundNum(Number(day.worked_hours ?? 0));
		const ot = roundNum(Number(day.overtime_hours ?? 0));
		const banked = roundNum(Number(day.time_off_hours ?? 0));
		overtimeHours += ot;
		bankedHours += banked;
		if (ot > 0 || banked > 0 || (workedHours > 0 && (dayType === 'REST' || holidayKind !== ''))) {
			detailDays.push({
				date,
				dayType,
				holiday,
				workedHours,
				overtimeHours: ot,
				bankedHours: banked
			});
		}
	}

	return {
		overtimeHours: roundNum(overtimeHours),
		bankedHours: roundNum(bankedHours),
		lines,
		days: detailDays
	};
};

const activePeopleOf = (sheet: OvertimeSheet): readonly OvertimePerson[] =>
	sheet.people
		.filter((person) => person.lines.length > 0 || person.bankedHours > 0)
		.toSorted((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

const catalogColumnsOf = (
	people: readonly OvertimePerson[]
): {
	readonly catalogs: readonly { readonly code: string; readonly label: string }[];
	readonly hasBanked: boolean;
} => {
	const seen = new Map<string, string>();
	let hasBanked = false;
	for (const person of people) {
		if (person.bankedHours > 0) hasBanked = true;
		for (const line of person.lines) {
			if (!seen.has(line.code)) seen.set(line.code, line.label);
		}
	}
	const catalogs = [...seen.entries()]
		.map(([code, label]) => ({ code, label }))
		.toSorted((a, b) => a.code.localeCompare(b.code));
	return { catalogs, hasBanked };
};

const amountFor = (person: OvertimePerson, code: string): number =>
	roundNum(
		person.lines
			.filter((line) => line.code === code)
			.reduce((total, line) => total + line.amount, 0)
	);

const totalPayOf = (person: OvertimePerson): number =>
	roundNum(person.lines.reduce((total, line) => total + line.amount, 0));

const IDENTITY = [
	{ header: 'EMPLOYEE CODE', width: 16, value: (p: OvertimePerson) => p.code },
	{ header: 'NAME', width: 30, value: (p: OvertimePerson) => p.name },
	{ header: 'DEPARTMENT', width: 22, value: (p: OvertimePerson) => p.department },
	{ header: 'POSITION', width: 24, value: (p: OvertimePerson) => p.position }
] as const;

const IDENTITY_FILL = 'FFCCFFFF';
const HOURS_FILL = 'FFF2F2F2';
const CATALOG_FILL = 'FFE2F0D9';
const TOTAL_FILL = 'FFC6E0B4';
const BANKED_FILL = 'FFFFF2CC';
const ACCOUNTING = '#,##0.00;(#,##0.00);"-"';
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const HEAD = 5;
const FROZEN = 2;

type NumericColumn = {
	readonly header: string;
	readonly fill: string;
	readonly bold: boolean;
	readonly width: number;
	readonly kind: 'hours' | 'catalog' | 'total' | 'banked';
	readonly value: (person: OvertimePerson) => number;
};

const addSummarySheet = (workbook: XlsxWorkbook, sheet: OvertimeSheet, name: string) => {
	const people = activePeopleOf(sheet);
	const { catalogs, hasBanked } = catalogColumnsOf(people);
	const numericColumns: NumericColumn[] = [
		{
			header: 'OT HOURS',
			fill: HOURS_FILL,
			bold: false,
			width: 14,
			kind: 'hours',
			value: (person) => person.overtimeHours
		},
		...catalogs.map((col): NumericColumn => ({
			header: col.label.toUpperCase(),
			fill: CATALOG_FILL,
			bold: false,
			width: Math.max(16, Math.min(28, col.label.length + 4)),
			kind: 'catalog',
			value: (person) => amountFor(person, col.code)
		})),
		{
			header: 'TOTAL OVERTIME PAY',
			fill: TOTAL_FILL,
			bold: true,
			width: 20,
			kind: 'total',
			value: totalPayOf
		},
		...(hasBanked
			? [
					{
						header: 'TIME-OFF BANKED (HRS)',
						fill: BANKED_FILL,
						bold: false,
						width: 22,
						kind: 'banked' as const,
						value: (person: OvertimePerson) => person.bankedHours
					}
				]
			: [])
	];

	const ws = workbook.addWorksheet(name, {
		views: [{ state: 'frozen', xSplit: FROZEN, ySplit: HEAD, zoomScale: 90 }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	const width = IDENTITY.length + numericColumns.length;
	ws.columns = [
		...IDENTITY.map((col) => ({ width: col.width })),
		...numericColumns.map((col) => ({ width: col.width }))
	];

	ws.getCell(1, 1).value = sheet.company.toUpperCase();
	ws.getCell(1, 1).font = { bold: true, size: 14 };
	const groupSuffix = sheet.payGroup === '' ? '' : ` · ${sheet.payGroup.toUpperCase()}`;
	const currencySuffix = sheet.currency === '' ? '' : ` (${sheet.currency})`;
	ws.getCell(2, 1).value =
		`OVERTIME REPORT - ${monthOf(sheet.period)}${groupSuffix}${currencySuffix}`;
	ws.getCell(2, 1).font = { bold: true, underline: true, size: 12 };
	ws.getCell(3, 1).value = `Attendance cutoff: ${sheet.attendance.from} to ${sheet.attendance.to}${
		sheet.jurisdiction === '' ? '' : ` (${sheet.jurisdiction})`
	}`;
	ws.getCell(3, 1).font = { italic: true, size: 10, color: { argb: 'FF595959' } };

	const headerRow = ws.getRow(HEAD);
	headerRow.height = 36;
	const headCols = [
		...IDENTITY.map((col) => ({ header: col.header, fill: IDENTITY_FILL })),
		...numericColumns.map((col) => ({ header: col.header, fill: col.fill }))
	];
	for (const [at, col] of headCols.entries()) {
		const cell = headerRow.getCell(at + 1);
		cell.value = col.header;
		cell.font = { bold: true, size: 10 };
		cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		cell.fill = solidFill(col.fill);
		cell.border = boxBorder(THIN);
	}

	const firstCatalogCol = IDENTITY.length + 2; // column after OT HOURS
	const lastCatalogCol = IDENTITY.length + 1 + catalogs.length;
	const firstCatalogLetter = catalogs.length > 0 ? ws.getColumn(firstCatalogCol).letter : undefined;
	const lastCatalogLetter = catalogs.length > 0 ? ws.getColumn(lastCatalogCol).letter : undefined;

	for (const [index, person] of people.entries()) {
		const rowNumber = HEAD + 1 + index;
		const row = ws.getRow(rowNumber);
		for (const [at, col] of IDENTITY.entries()) row.getCell(at + 1).value = col.value(person);
		for (const [at, col] of numericColumns.entries()) {
			const cell = row.getCell(IDENTITY.length + at + 1);
			const result = col.value(person);
			cell.value =
				col.kind === 'total'
					? firstCatalogLetter !== undefined && lastCatalogLetter !== undefined
						? {
								formula: `SUM(${firstCatalogLetter}${rowNumber}:${lastCatalogLetter}${rowNumber})`,
								result
							}
						: 0
					: result;
			cell.numFmt = ACCOUNTING;
			cell.fill = solidFill(col.fill);
			if (col.bold) cell.font = { bold: true };
		}
		for (let column = 1; column <= width; column++) row.getCell(column).border = boxBorder(THIN);
	}

	const last = HEAD + people.length;
	const totals = ws.getRow(last + 1);
	totals.getCell(FROZEN).value = 'GRAND TOTAL';
	for (const [at, col] of numericColumns.entries()) {
		const cell = totals.getCell(IDENTITY.length + at + 1);
		const letter = ws.getColumn(IDENTITY.length + at + 1).letter;
		cell.value = {
			formula: people.length === 0 ? '0' : `SUM(${letter}${HEAD + 1}:${letter}${last})`,
			result: roundNum(people.reduce((total, person) => total + col.value(person), 0))
		};
		cell.numFmt = ACCOUNTING;
	}
	styleTotalsRow(ws, last + 1, width, THIN);
	if (people.length > 0)
		ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: width } };
};

const addDetailsSheet = (
	workbook: XlsxWorkbook,
	sheets: readonly { readonly sheet: OvertimeSheet; readonly name: string }[]
) => {
	const ws = workbook.addWorksheet('Daily details', {
		views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	const columns = [
		['SHEET', 24],
		['PERIOD', 14],
		['PAY GROUP', 22],
		['ATTENDANCE CUTOFF', 25],
		['EMPLOYEE CODE', 16],
		['NAME', 30],
		['DEPARTMENT', 22],
		['WORK DATE', 14],
		['DAY TYPE', 12],
		['HOLIDAY', 24],
		['WORKED HRS', 13],
		['OVERTIME HRS', 14],
		['TIME-OFF BANKED (HRS)', 22]
	] as const;
	ws.columns = columns.map(([header, width]) => ({ header, width }));
	for (const { sheet, name } of sheets) {
		const cutoff = `${sheet.attendance.from} to ${sheet.attendance.to}`;
		for (const person of activePeopleOf(sheet))
			for (const item of person.days) {
				const row = ws.addRow([
					name,
					sheet.period,
					sheet.payGroup,
					cutoff,
					person.code,
					person.name,
					person.department,
					item.date,
					item.dayType,
					item.holiday,
					item.workedHours,
					item.overtimeHours,
					item.bankedHours
				]);
				row.getCell(11).numFmt = '0.####';
				row.getCell(12).numFmt = '0.####';
				row.getCell(13).numFmt = '0.####';
			}
	}
	styleDetailSheet(ws, columns.length, 30, IDENTITY_FILL);
};

/** Builds the styled overtime report workbook: one sheet per period/pay group plus `Daily details`. */
export const overtimeWorkbookOf = (sheets: readonly OvertimeSheet[]) => {
	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'HRMS';
	const taken = new Set<string>(['daily details']);
	const periodCounts = new Map<string, number>();
	for (const sheet of sheets)
		periodCounts.set(sheet.period, (periodCounts.get(sheet.period) ?? 0) + 1);
	const named = sheets.map((sheet) => {
		const base = monthOf(sheet.period);
		const label =
			(periodCounts.get(sheet.period) ?? 0) > 1 && sheet.payGroup !== ''
				? `${base} - ${sheet.payGroup}`
				: base;
		return { sheet, name: uniqueSheetName(label, taken, { replace: ' ', fallback: 'Overtime' }) };
	});
	for (const { sheet, name } of named) addSummarySheet(workbook, sheet, name);
	addDetailsSheet(workbook, named);
	return workbook;
};
