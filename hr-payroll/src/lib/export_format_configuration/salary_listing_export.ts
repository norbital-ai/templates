import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { Schema } from 'effect';
import { PayslipBreakdown } from '../payroll_engine/payslip_breakdown.js';

/**
 * The staff salary listing as payroll teams keep it: one sheet per run, the company and `STAFF SALARY LISTING - <month>`
 * above a group row and upper-case column headers. Who the person is comes first (frozen through NAME), then basic pay,
 * earnings, GROSS PAY, the deductions, the employee's statutory portion, NET PAY, the employer's portion and the cost to
 * the company, and a TOTAL row. Every figure is a payslip's own line or total.
 */
type Person = {
	readonly position: string;
	readonly department: string;
	readonly code: string;
	readonly name: string;
	readonly identity: string;
	readonly joined: string;
	readonly left: string;
	readonly breakdown: PayslipBreakdown;
	readonly gross: number;
	readonly net: number;
};
export type Sheet = {
	readonly company: string;
	readonly currency: string;
	readonly period: string;
	readonly offCycle: boolean;
	readonly people: readonly Person[];
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** `2026-10` → `OCT 2026`, a half-month `2026-10-1` → `OCT 2026 1ST HALF`. */
const monthOf = (period: string) => {
	const match = /^(\d{4})-(\d{2})(?:-([12]))?$/.exec(period);
	if (match === null) return period.toUpperCase();
	const half = match[3] === undefined ? '' : match[3] === '1' ? ' 1ST HALF' : ' 2ND HALF';
	return `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}${half}`;
};
const amount = (value: unknown): number => {
	// a decimal reaches a page as `{ $dec }`, and a stored read as a Decimal
	const raw = typeof value === 'object' && value !== null && '$dec' in value ? value.$dec : value;
	const number = typeof raw === 'number' ? raw : Number(String(raw ?? ''));
	return Number.isFinite(number) ? number : 0;
};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const dayOf = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : '');

/** What the listing reads: the runs, their payslips (each with its contract) and the people's contract versions. */
export type ListingRead = {
	readonly runs: readonly {
		readonly id: string;
		readonly period: unknown;
		readonly kind: unknown;
		readonly entity_id?: { readonly name?: unknown } | null;
		readonly settings_id?: { readonly currency?: unknown } | null;
	}[];
	readonly slips: readonly {
		readonly payroll_run_id: unknown;
		readonly employee_id: unknown;
		readonly gross_earnings: unknown;
		readonly net_pay: unknown;
		readonly breakdown: unknown;
		readonly employment_id?: {
			readonly employee_number?: unknown;
			readonly employee_name?: unknown;
			readonly service_started_on?: unknown;
			readonly terms?: { readonly job_title?: unknown; readonly department?: unknown } | null;
			readonly payroll?: { readonly identity_number?: unknown } | null;
		} | null;
	}[];
	readonly versions: readonly {
		readonly employee_id: unknown;
		readonly effective_range: { readonly from: unknown; readonly to?: unknown };
	}[];
};

/** Each run's sheet, in period order, its people by employee code. */
export const sheetsOf = ({ runs, slips, versions }: ListingRead): readonly Sheet[] => {
	const joined = new Map<string, string>();
	const left = new Map<string, string>();
	for (const [person, rows] of Map.groupBy(versions, (row) => String(row.employee_id))) {
		const ordered = rows.toSorted((a, b) =>
			dayOf(a.effective_range.from).localeCompare(dayOf(b.effective_range.from))
		);
		joined.set(person, dayOf(ordered[0]?.effective_range.from));
		// someone has left when their latest version ends
		const to = ordered.at(-1)?.effective_range.to;
		if (to != null) left.set(person, dayOf(to));
	}
	const byRun = Map.groupBy(slips, (slip) => String(slip.payroll_run_id));
	return runs
		.toSorted((a, b) => String(a.period).localeCompare(String(b.period)))
		.map((run): Sheet => ({
			company: text(run.entity_id?.name),
			currency: text(run.settings_id?.currency),
			period: String(run.period),
			offCycle: run.kind === 'OFF_CYCLE',
			people: (byRun.get(run.id) ?? [])
				.flatMap((slip): Person[] => {
					const contract = slip.employment_id;
					const breakdown = Schema.decodeUnknownOption(PayslipBreakdown)(slip.breakdown);
					if (contract == null || breakdown._tag === 'None') return [];
					const person = String(slip.employee_id);
					return [
						{
							position: text(contract.terms?.job_title),
							department: text(contract.terms?.department),
							code: text(contract.employee_number),
							name: text(contract.employee_name),
							identity: text(contract.payroll?.identity_number),
							joined: dayOf(contract.service_started_on) || (joined.get(person) ?? ''),
							left: left.get(person) ?? '',
							breakdown: breakdown.value,
							gross: amount(slip.gross_earnings),
							net: amount(slip.net_pay)
						}
					];
				})
				.toSorted((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
		}));
};

type Line = PayslipBreakdown['lines'][number];
type Section =
	| 'basic'
	| 'allowances'
	| 'overtime'
	| 'earnings'
	| 'deductions'
	| 'loans'
	| 'employee'
	| 'employer';
type Column = {
	readonly section: Section | 'total';
	readonly group: string;
	readonly header: string;
	readonly value: (person: Person) => number;
};
const STATUTORY = 'statutory_contribution_catalog';
/** Where a line sits on the sheet, by who bears it, its kind and the way it first moves. */
const sectionOf = (line: Line): Section => {
	if (line.party === 'EMPLOYER') return 'employer';
	if (line.source === STATUTORY) return 'employee';
	if (line.source === 'loan_catalog_entry_repayment') return 'loans';
	if (line.direction === 'DEDUCT') return 'deductions';
	if (line.source === 'employee_contract') return 'basic';
	if (line.source === 'allowance_catalog') return 'allowances';
	if (line.source === 'overtime_catalog') return 'overtime';
	return 'earnings';
};
const GROUP: { readonly [S in Section]: string } = {
	basic: '',
	allowances: 'ALLOWANCES',
	overtime: 'OVERTIME',
	earnings: '',
	deductions: 'DEDUCTIONS',
	loans: 'LOANS',
	employee: 'EMPLOYEE PORTION',
	employer: 'EMPLOYER PORTION'
};
const EARNINGS: readonly Section[] = ['basic', 'allowances', 'overtime', 'earnings'];
const keyOf = (line: Line) => `${line.source}:${line.code}`;
/** A line's amount as its column reads it: earnings add, what is taken from the person or paid for them is positive. */
const signed = (section: Section, line: Line) =>
	(line.direction === 'DEDUCT') ===
	(section === 'deductions' || section === 'loans' || section === 'employee')
		? line.amount
		: -line.amount;

/** The sheet's columns: one per distinct line, in its section, with the payslip totals between them. */
const columnsOf = (sheet: Sheet): readonly Column[] => {
	const kind = new Map<string, string>();
	for (const person of sheet.people)
		for (const scheme of person.breakdown.statutory) kind.set(scheme.code, scheme.kind);
	const found = new Map<string, { section: Section; line: Line }>();
	for (const person of sheet.people)
		for (const line of person.breakdown.lines)
			if (!found.has(keyOf(line))) found.set(keyOf(line), { section: sectionOf(line), line });
	const lines = (section: Section): Column[] => {
		const columns = [...found]
			.filter(([, entry]) => entry.section === section)
			.map(([key, { line }]): Column & { readonly tax: boolean } => ({
				section,
				group: GROUP[section],
				header: (line.source === STATUTORY ? line.code.replace(/_EMPLOYER$/, '') : line.label)
					.replaceAll('_', ' ')
					.toUpperCase(),
				tax: kind.get(line.code) === 'TAX',
				value: (person) =>
					person.breakdown.lines
						.filter((own) => keyOf(own) === key)
						.reduce((total, own) => total + signed(section, own), 0)
			}));
		if (section !== 'employee' && section !== 'employer') return columns;
		// a portion reads largest scheme first and its taxes last, as payroll teams keep it (EPF, SOCSO, EIS, then PCB)
		const size = (column: Column) =>
			sheet.people.reduce((total, person) => total + column.value(person), 0);
		return columns.toSorted(
			(a, b) =>
				Number(a.tax) - Number(b.tax) || size(b) - size(a) || a.header.localeCompare(b.header)
		);
	};
	const sum = (sections: readonly Section[], person: Person) =>
		person.breakdown.lines
			.filter((line) => sections.includes(sectionOf(line)))
			.reduce((total, line) => total + signed(sectionOf(line), line), 0);
	const total = (header: string, value: (person: Person) => number): Column => ({
		section: 'total',
		group: '',
		header,
		value
	});
	return [
		...EARNINGS.flatMap(lines),
		total('GROSS PAY', (person) => person.gross),
		...lines('deductions'),
		...lines('loans'),
		...lines('employee'),
		total('NET PAY', (person) => person.net),
		...lines('employer'),
		// what the company pays out for the person: their pay, what goes to the authorities on their behalf, and its own share
		total(
			'COST TO COMPANY',
			(person) => person.net + sum(['employee'], person) + sum(['employer'], person)
		)
	];
};

const FILL: { readonly [S in Column['section'] | 'identity']: string } = {
	identity: 'FFCCFFFF',
	basic: 'FFCCFFCC',
	allowances: 'FFCCFFCC',
	overtime: 'FFCCFFCC',
	earnings: 'FFCCFFCC',
	deductions: 'FFFFC000',
	loans: 'FFFFC000',
	employee: 'FFFFFF00',
	employer: 'FFFCE4D6',
	total: 'FFD9D9D9'
};
const ACCOUNTING = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
const THIN = { style: 'thin', color: { argb: 'FF808080' } } as const;
const IDENTITY = [
	{ header: 'POSITION', width: 24, value: (person: Person) => person.position },
	{ header: 'DEPARTMENT', width: 20, value: (person: Person) => person.department },
	{ header: 'EMPLOYEE CODE', width: 15, value: (person: Person) => person.code },
	{ header: 'NAME', width: 34, value: (person: Person) => person.name },
	{ header: 'IC / ID NO.', width: 18, value: (person: Person) => person.identity },
	{ header: 'DATE JOIN', width: 13, date: true, value: (person: Person) => person.joined },
	{ header: 'LAST DAY', width: 13, date: true, value: (person: Person) => person.left }
] as const;
/** Frozen through NAME, as the listings are read across. */
const FROZEN = 4;
const HEAD = 4;

const dateOf = (day: string) => {
	const [year, month, date] = day.split('-').map(Number);
	return year === undefined || month === undefined || date === undefined
		? day
		: new Date(Date.UTC(year, month - 1, date));
};
const sheetName = (sheet: Sheet, taken: Set<string>) => {
	const base = `${monthOf(sheet.period)}${sheet.offCycle ? ' OFF-CYCLE' : ''}`
		.replaceAll(/[\\/?*[\]:]/g, '-')
		.slice(0, 27);
	let name = base;
	for (let next = 2; taken.has(name); next++) name = `${base} (${next})`;
	taken.add(name);
	return name;
};

/** One run's sheet, laid out as the listing. */
const addSheet = (
	workbook: InstanceType<typeof ExcelJSBrowser.Workbook>,
	sheet: Sheet,
	name: string
) => {
	const columns = columnsOf(sheet);
	const ws = workbook.addWorksheet(name, {
		views: [{ state: 'frozen', xSplit: FROZEN, ySplit: HEAD, zoomScale: 85 }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	const width = IDENTITY.length + columns.length;
	ws.columns = [
		...IDENTITY.map((column) => ({ width: column.width })),
		...columns.map((column) => ({ width: column.section === 'total' ? 16 : 14 }))
	];
	ws.getCell(1, 1).value = sheet.company.toUpperCase();
	ws.getCell(1, 1).font = { bold: true, size: 14 };
	ws.getCell(2, 1).value = `STAFF SALARY LISTING - ${monthOf(sheet.period)}${
		sheet.offCycle ? ' (OFF-CYCLE)' : ''
	}${sheet.currency === '' ? '' : ` (${sheet.currency})`}`;
	ws.getCell(2, 1).font = { bold: true, underline: true, size: 12 };

	// a group row above the column headers; a column with no group takes both rows
	const head = [
		...IDENTITY.map((column) => ({
			group: '',
			header: column.header,
			section: 'identity' as const
		})),
		...columns
	];
	for (let index = 0; index < head.length;) {
		const start = index;
		const group = head[index]?.group ?? '';
		if (group === '') {
			ws.mergeCells(HEAD - 1, start + 1, HEAD, start + 1);
			index++;
		} else {
			while (index < head.length && head[index]?.group === group) index++;
			if (index - start > 1) ws.mergeCells(HEAD - 1, start + 1, HEAD - 1, index);
			ws.getCell(HEAD - 1, start + 1).value = group;
		}
		for (let column = start; column < index; column++) {
			const entry = head[column];
			if (entry === undefined) continue;
			ws.getCell(HEAD, column + 1).value = entry.header;
			if (group === '') ws.getCell(HEAD - 1, column + 1).value = entry.header;
			for (const row of [HEAD - 1, HEAD]) {
				const cell = ws.getCell(row, column + 1);
				cell.font = { bold: true, size: 10 };
				cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[entry.section] } };
				cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
			}
		}
	}
	ws.getRow(HEAD - 1).height = 22;
	ws.getRow(HEAD).height = 48;

	for (const [index, person] of sheet.people.entries()) {
		const row = ws.getRow(HEAD + 1 + index);
		for (const [at, column] of IDENTITY.entries()) {
			const value = column.value(person);
			const cell = row.getCell(at + 1);
			cell.value = 'date' in column && value !== '' ? dateOf(value) : value;
			if ('date' in column) cell.numFmt = 'd mmm yyyy';
		}
		for (const [at, column] of columns.entries()) {
			const cell = row.getCell(IDENTITY.length + at + 1);
			cell.value = column.value(person);
			cell.numFmt = ACCOUNTING;
			if (column.section === 'total') cell.font = { bold: true };
		}
		for (let column = 1; column <= width; column++)
			row.getCell(column).border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
	}

	const last = HEAD + sheet.people.length;
	const totals = ws.getRow(last + 1);
	totals.getCell(FROZEN).value = 'TOTAL';
	for (const [at, column] of columns.entries()) {
		const cell = totals.getCell(IDENTITY.length + at + 1);
		const letter = ws.getColumn(IDENTITY.length + at + 1).letter;
		cell.value = {
			formula: `SUM(${letter}${HEAD + 1}:${letter}${last})`,
			result: sheet.people.reduce((total, person) => total + column.value(person), 0)
		};
		cell.numFmt = ACCOUNTING;
	}
	for (let column = 1; column <= width; column++) {
		const cell = totals.getCell(column);
		cell.font = { bold: true };
		cell.border = { top: THIN, bottom: { style: 'double', color: { argb: 'FF000000' } } };
	}
	ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: width } };
};

/** The listing of these runs as one workbook, a sheet each. */
export const workbookOf = (sheets: readonly Sheet[]) => {
	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'Payroll';
	const taken = new Set<string>();
	for (const sheet of sheets) addSheet(workbook, sheet, sheetName(sheet, taken));
	return workbook;
};
