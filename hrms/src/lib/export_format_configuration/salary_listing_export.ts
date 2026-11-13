import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { Schema } from 'effect';
import { PayslipBreakdown } from '../payroll_engine/payslip_breakdown.js';

/**
 * The staff salary listing: one sheet per run, the company and `STAFF SALARY LISTING - <month>` above a group row and
 * upper-case column headers. Who the person is comes first (frozen through NAME). Then the pay follows the law's own
 * subtotal chain, as the payslip worked it out: each subtotal is a coloured band of the lines that move it (what adds
 * reads positive, what takes off negative) closed by the subtotal itself, so a proration sits in its band and the band
 * closes on the prorated figure. GROSS PAY stands before the first band that holds a statutory deduction, TAX WITHHELD
 * after the band that holds the tax (it counts every tax the payslip withholds, an instalment the authority directs
 * included), then NET PAY, the employer's portion and the cost to the company, and a TOTAL row. Nothing names a code:
 * the bands, their order and their names are each law's subtotals. Every figure is a payslip's own line or total.
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
	/** Every tax the payslip withholds: the scheme's and any the authority directs on top (its stored `tax_withheld`). */
	readonly tax: number;
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
	// a decimal reads as its exact text
	const number = typeof value === 'number' ? value : Number(String(value ?? ''));
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
		readonly tax_withheld?: unknown;
		readonly breakdown: unknown;
		readonly employment_id?: {
			readonly employee_number?: unknown;
			readonly employee_id?: { readonly name?: unknown } | null;
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
							name: text(contract.employee_id?.name),
							identity: text(contract.payroll?.identity_number),
							joined: dayOf(contract.service_started_on) || (joined.get(person) ?? ''),
							left: left.get(person) ?? '',
							breakdown: breakdown.value,
							gross: amount(slip.gross_earnings),
							net: amount(slip.net_pay),
							tax: amount(slip.tax_withheld)
						}
					];
				})
				.toSorted((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
		}));
};

type Line = PayslipBreakdown['lines'][number];
type Column = {
	/** The band a column belongs to: a subtotal's id, or one of the listing's own totals. */
	readonly band: string;
	/** The group row's text above it: the subtotal's name, or empty for a total that stands alone. */
	readonly group: string;
	readonly header: string;
	readonly fill: string;
	/** A closing or summary figure: bold, wider. */
	readonly total: boolean;
	readonly value: (person: Person) => number;
};
const STATUTORY = 'statutory_contribution_catalog';
/** Light fills a band takes in turn, and the deeper one its closing subtotal takes. */
const BANDS = [
	['FFE2F0D9', 'FFC6E0B4'],
	['FFDDEBF7', 'FFBDD7EE'],
	['FFFFF2CC', 'FFFFE699'],
	['FFFCE4D6', 'FFF8CBAD'],
	['FFEDE7F6', 'FFD1C4E9'],
	['FFE0F2F1', 'FFB2DFDB']
] as const;
const IDENTITY_FILL = 'FFCCFFFF';
const TOTAL_FILL = 'FFD9D9D9';
const EMPLOYER_FILL = ['FFF2F2F2', 'FFD9D9D9'] as const;
const signed = (line: Line) => (line.direction === 'DEDUCT' ? -line.amount : line.amount);
const keyOf = (line: Line) =>
	`${line.source}:${line.code}:${line.period === undefined ? '' : 'earlier'}`;

/**
 * The sheet's columns, read off its payslips: the subtotal chain in the order the law runs it, each band with the lines
 * any payslip posts to it, then the summary totals.
 */
const columnsOf = (sheet: Sheet): readonly Column[] => {
	const kind = new Map<string, string>();
	const chain: { id: string; name: string }[] = [];
	for (const person of sheet.people) {
		for (const scheme of person.breakdown.statutory) kind.set(scheme.code, scheme.kind);
		for (const point of person.breakdown.checkpoints)
			if (!chain.some((known) => known.id === point.id))
				chain.push({ id: point.id, name: point.name });
	}
	const lines = new Map<string, Line>();
	for (const person of sheet.people)
		for (const line of person.breakdown.lines) lines.set(keyOf(line), line);
	const sum = (key: string) => (person: Person) =>
		person.breakdown.lines
			.filter((own) => keyOf(own) === key)
			.reduce((total, own) => total + signed(own), 0);
	const header = (line: Line) =>
		`${line.source === STATUTORY ? line.code.replace(/_EMPLOYER$/, '') : line.label}${
			line.period === undefined ? '' : ' (earlier periods)'
		}`
			.replaceAll('_', ' ')
			.toUpperCase();
	// within a band what adds comes first, then what takes off; the statutory shares largest first and taxes last
	const size = (key: string) =>
		sheet.people.reduce((total, person) => total + Math.abs(sum(key)(person)), 0);
	const rank = (line: Line) =>
		line.source !== STATUTORY
			? line.direction === 'ADD'
				? 0
				: 1
			: kind.get(line.code) === 'TAX'
				? 3
				: 2;
	const employee = [...lines].filter(([, line]) => line.party !== 'EMPLOYER');
	const known = new Set(chain.map((band) => band.id));
	const bands = [
		...chain,
		// a line on a subtotal no payslip reports closes nowhere: it still shows, in a band of its own
		...[...new Set(employee.map(([, line]) => line.subtotal_id))]
			.filter((id) => !known.has(id))
			.map((id) => ({ id, name: '' }))
	];
	const columns: Column[] = [];
	let grossPlaced = false,
		painted = 0;
	for (const band of bands) {
		const own = employee
			.filter(([, line]) => line.subtotal_id === band.id)
			.toSorted(
				([a, left], [b, right]) =>
					rank(left) - rank(right) || size(b) - size(a) || a.localeCompare(b)
			);
		if (own.length === 0) continue;
		if (!grossPlaced && own.some(([, line]) => line.source === STATUTORY)) {
			columns.push({
				band: 'gross',
				group: '',
				header: 'GROSS PAY',
				fill: TOTAL_FILL,
				total: true,
				value: (p) => p.gross
			});
			grossPlaced = true;
		}
		const [fill = BANDS[0][0], deep = BANDS[0][1]] = BANDS[painted++ % BANDS.length] ?? [];
		const group = band.name.toUpperCase();
		const close = (person: Person) =>
			person.breakdown.checkpoints.find((point) => point.id === band.id)?.value ?? 0;
		for (const [key, line] of own)
			// a line that is its band's subtotal under the same name shows once, as the subtotal
			if (!(
				band.name !== '' &&
				header(line) === group &&
				sheet.people.every((p) => sum(key)(p) === close(p))
			))
				columns.push({
					band: band.id,
					group,
					header: header(line),
					fill,
					total: false,
					value: sum(key)
				});
		if (band.name !== '')
			columns.push({ band: band.id, group, header: group, fill: deep, total: true, value: close });
		if (own.some(([, line]) => line.source === STATUTORY && kind.get(line.code) === 'TAX'))
			columns.push({
				band: band.id,
				group,
				header: 'TAX WITHHELD',
				fill: deep,
				total: true,
				value: (p) => p.tax
			});
	}
	if (!grossPlaced)
		columns.push({
			band: 'gross',
			group: '',
			header: 'GROSS PAY',
			fill: TOTAL_FILL,
			total: true,
			value: (p) => p.gross
		});
	columns.push({
		band: 'net',
		group: '',
		header: 'NET PAY',
		fill: TOTAL_FILL,
		total: true,
		value: (p) => p.net
	});
	const employer = [...lines]
		.filter(([, line]) => line.party === 'EMPLOYER')
		.toSorted(
			([a, left], [b, right]) => rank(left) - rank(right) || size(b) - size(a) || a.localeCompare(b)
		);
	// the employer's portion reads as amounts it pays, positive
	for (const [key, line] of employer)
		columns.push({
			band: 'employer',
			group: "EMPLOYER'S PORTION",
			header: header(line),
			fill: EMPLOYER_FILL[0],
			total: false,
			value: (person) => Math.abs(sum(key)(person))
		});
	const employerTotal = (person: Person) =>
		employer.reduce((total, [key]) => total + Math.abs(sum(key)(person)), 0);
	// what the company pays out for the person: their pay, what goes to the authorities on their behalf (contributions
	// and every tax withheld) and its own share; a repayment the company takes back is no cost
	const contributions = (person: Person) =>
		person.breakdown.lines
			.filter(
				(line) =>
					line.party !== 'EMPLOYER' && line.source === STATUTORY && kind.get(line.code) !== 'TAX'
			)
			.reduce((total, line) => total - signed(line), 0);
	columns.push({
		band: 'cost',
		group: '',
		header: 'COST TO COMPANY',
		fill: TOTAL_FILL,
		total: true,
		value: (person) => person.net + contributions(person) + person.tax + employerTotal(person)
	});
	return columns;
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
		...columns.map((column) => ({ width: column.total ? 16 : 14 }))
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
			fill: IDENTITY_FILL
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
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: entry.fill } };
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
			// the band's colour runs down its figures, so a subtotal's lines read as one block
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column.fill } };
			if (column.total) cell.font = { bold: true };
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
