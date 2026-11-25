import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { DateTime, Option, Schema } from 'effect';
import { PayslipBreakdown } from '../payslip_breakdown.js';

/** A run per sheet, one signed column per catalogue item and party, plus its saved payroll totals. */
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
	readonly contributions: number;
	readonly employer: number;
};
export type Sheet = {
	readonly company: string;
	readonly currency: string;
	readonly period: string;
	readonly offCycle: boolean;
	readonly people: readonly Person[];
};

/** `2026-10` → `OCT 2026`, a half-month `2026-10-1` → `OCT 2026 1ST HALF`. */
const monthOf = (period: string) => {
	const match = /^(\d{4})-(\d{2})(?:-([12]))?$/.exec(period);
	if (match === null) return period.toUpperCase();
	const half = match[3] === undefined ? '' : match[3] === '1' ? ' 1ST HALF' : ' 2ND HALF';
	const month = DateTime.formatUtc(DateTime.makeUnsafe(`${match[1]}-${match[2]}-01`), {
		locale: 'en',
		month: 'short',
		year: 'numeric'
	});
	return `${month.toUpperCase()}${half}`;
};
const amount = (value: unknown): number => {
	if (value == null || (typeof value === 'string' && value.trim() === ''))
		throw new Error('The salary listing needs every saved payslip total.');
	// a decimal reads as its exact text
	const number = typeof value === 'number' ? value : Number(String(value ?? ''));
	if (!Number.isFinite(number))
		throw new Error('The salary listing contains an invalid saved amount.');
	return number;
};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const dayOf = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : '');

/**
 * What the listing reads: the runs, their payslips (each with its stint as it stood at the period's end) and the
 * people's stints.
 */
export type ListingRead = {
	readonly runs: readonly {
		readonly id: string;
		readonly period: unknown;
		readonly kind: unknown;
		readonly entity_id?: { readonly name?: unknown } | null;
		readonly currency: unknown;
	}[];
	readonly slips: readonly {
		readonly payroll_run_id: unknown;
		readonly employee_id: unknown;
		readonly gross_earnings: unknown;
		readonly net_pay: unknown;
		readonly tax_withheld: unknown;
		readonly employee_statutory: unknown;
		readonly employer_cost: unknown;
		readonly breakdown: unknown;
		readonly employment_id?: {
			readonly employee_number?: unknown;
			readonly employee_id?: { readonly name?: unknown } | null;
			readonly service_started_on?: unknown;
			readonly terms?: { readonly job_title?: unknown; readonly department?: unknown } | null;
			readonly payroll?: { readonly identity_number?: unknown } | null;
		} | null;
	}[];
	readonly stints: readonly {
		readonly employee_id: unknown;
		readonly effective_range: { readonly from: unknown; readonly to?: unknown };
	}[];
};

/** Each run's sheet, in period order, its people by employee code. */
export const sheetsOf = ({ runs, slips, stints }: ListingRead): readonly Sheet[] => {
	const joined = new Map<string, string>();
	const left = new Map<string, string>();
	for (const [person, rows] of Map.groupBy(stints, (row) => String(row.employee_id))) {
		const ordered = rows.toSorted((a, b) =>
			dayOf(a.effective_range.from).localeCompare(dayOf(b.effective_range.from))
		);
		joined.set(person, dayOf(ordered[0]?.effective_range.from));
		// someone has left when their latest stint ends
		const to = ordered.at(-1)?.effective_range.to;
		if (to != null) left.set(person, dayOf(to));
	}
	const byRun = Map.groupBy(slips, (slip) => String(slip.payroll_run_id));
	return runs
		.toSorted((a, b) => String(a.period).localeCompare(String(b.period)))
		.map((run): Sheet => ({
			company: text(run.entity_id?.name),
			currency: text(run.currency),
			period: String(run.period),
			offCycle: run.kind === 'OFF_CYCLE',
			people: (byRun.get(run.id) ?? [])
				.map((slip): Person => {
					const contract = slip.employment_id;
					const breakdown = Schema.decodeUnknownOption(PayslipBreakdown)(slip.breakdown);
					if (contract == null || breakdown._tag === 'None')
						throw new Error(
							'A payslip is missing its employment or saved breakdown; the salary listing was not exported.'
						);
					for (const line of breakdown.value.lines)
						if (
							!Number.isFinite(line.amount) ||
							line.amount < 0 ||
							!['ADD', 'DEDUCT'].includes(line.direction) ||
							!['EMPLOYEE', 'EMPLOYER'].includes(line.party)
						)
							throw new Error(
								'A payslip contains an invalid saved line; the salary listing was not exported.'
							);
					const person = String(slip.employee_id);
					return {
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
						tax: amount(slip.tax_withheld),
						contributions: amount(slip.employee_statutory),
						employer: amount(slip.employer_cost)
					};
				})
				.toSorted((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
		}));
};

type Line = PayslipBreakdown['lines'][number];
type Column = {
	/** The band a column belongs to: a subtotal's code, or one of the listing's own totals. */
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
const keyOf = (line: Line) => JSON.stringify([line.source, line.code, line.party]);

/**
 * The sheet's columns, read off its payslips: the subtotal chain in the order the law runs it, each band with the lines
 * any payslip posts to it, then the summary totals.
 */
const columnsOf = (sheet: Sheet): readonly Column[] => {
	const kind = new Map<string, string>();
	const chain: { code: string; name: string }[] = [];
	for (const person of sheet.people) {
		for (const scheme of person.breakdown.statutory) kind.set(scheme.code, scheme.kind);
		for (const point of person.breakdown.checkpoints)
			if (!chain.some((known) => known.code === point.code))
				chain.push({ code: point.code, name: point.name });
	}
	const lines = new Map<string, Line>();
	for (const person of sheet.people)
		for (const line of person.breakdown.lines)
			// A current-period line supplies the label and band when a carried correction or back-pay line moved subtotals.
			if (
				!lines.has(keyOf(line)) ||
				(line.period === undefined && line.back_pay_period === undefined)
			)
				lines.set(keyOf(line), line);
	const sum = (key: string) => (person: Person) =>
		person.breakdown.lines
			.filter((own) => keyOf(own) === key)
			.reduce((total, own) => total + signed(own), 0);
	const header = (line: Line) =>
		(line.source === STATUTORY ? line.code.replace(/_EMPLOYER$/, '') : line.label)
			.replaceAll('_', ' ')
			.toUpperCase();
	// Catalogue identity keeps the order stable when amounts, refunds or earlier-period lines change.
	const rank = (line: Line) => (line.source === STATUTORY ? 1 : 0);
	const order = ([, left]: [string, Line], [, right]: [string, Line]) =>
		rank(left) - rank(right) ||
		left.source.localeCompare(right.source) ||
		left.code.localeCompare(right.code) ||
		left.party.localeCompare(right.party);
	const employee = [...lines].filter(([, line]) => line.party !== 'EMPLOYER');
	const known = new Set(chain.map((band) => band.code));
	const bands = [
		...chain,
		// a line on a subtotal no payslip reports closes nowhere: it still shows, in a band of its own
		...[...new Set(employee.map(([, line]) => line.subtotal))]
			.filter((code) => !known.has(code))
			.map((code) => ({ code, name: '' }))
	];
	const columns: Column[] = [];
	let taxPlaced = false,
		grossPlaced = false,
		painted = 0;
	for (const band of bands) {
		const own = employee.filter(([, line]) => line.subtotal === band.code).toSorted(order);
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
			person.breakdown.checkpoints.find((point) => point.code === band.code)?.value ?? 0;
		for (const [key, line] of own)
			columns.push({
				band: band.code,
				group,
				header: header(line),
				fill,
				total: false,
				value: sum(key)
			});
		// A catalogue already named for the subtotal keeps its own column, even when its amount changes.
		if (
			group !== '' &&
			!own.some(([, line]) => header(line) === group) &&
			!['GROSS PAY', 'NET PAY', 'TAX WITHHELD'].includes(group)
		)
			columns.push({
				band: band.code,
				group,
				header: `${group} (PERIOD ONLY)`,
				fill: deep,
				total: true,
				value: close
			});
		if (
			!taxPlaced &&
			own.some(([, line]) => line.source === STATUTORY && kind.get(line.code) === 'TAX')
		) {
			taxPlaced = true;
			columns.push({
				band: band.code,
				group,
				header: 'TAX WITHHELD',
				fill: deep,
				total: true,
				value: (p) => p.tax
			});
		}
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
	// A month may withhold an instructed instalment even when the calculated tax has no line.
	if (!taxPlaced)
		columns.push({
			band: 'tax',
			group: '',
			header: 'TAX WITHHELD',
			fill: TOTAL_FILL,
			total: true,
			value: (p) => p.tax
		});
	columns.push({
		band: 'net',
		group: '',
		header: 'NET PAY',
		fill: TOTAL_FILL,
		total: true,
		value: (p) => p.net
	});
	const employer = [...lines].filter(([, line]) => line.party === 'EMPLOYER').toSorted(order);
	// Employer refunds retain their saved direction, just as employee refunds do.
	for (const [key, line] of employer)
		columns.push({
			band: 'employer',
			group: "EMPLOYER'S PORTION",
			header: header(line),
			fill: EMPLOYER_FILL[0],
			total: false,
			value: sum(key)
		});
	// This is the existing cash-outlay summary, using saved totals rather than pricing any line again.
	columns.push({
		band: 'cost',
		group: '',
		header: 'COST TO COMPANY',
		fill: TOTAL_FILL,
		total: true,
		value: (person) => person.net + person.contributions + person.tax + person.employer
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

const sheetName = (label: string, taken: Set<string>) => {
	const base = label.replaceAll(/[\\/?*[\]:]/g, '-');
	let name = base.slice(0, 31);
	for (let next = 2; taken.has(name.toLowerCase()); next++) {
		const suffix = ` (${next})`;
		name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
	}
	taken.add(name.toLowerCase());
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
			cell.value =
				'date' in column && value !== ''
					? DateTime.make(value).pipe(
							Option.map(DateTime.toDateUtc),
							Option.getOrElse(() => value)
						)
					: value;
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
			formula: sheet.people.length === 0 ? '0' : `SUM(${letter}${HEAD + 1}:${letter}${last})`,
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

/** Every saved line remains inspectable, including the period a correction belongs to. */
const addDetails = (
	workbook: InstanceType<typeof ExcelJSBrowser.Workbook>,
	sheets: readonly { sheet: Sheet; name: string }[]
) => {
	const ws = workbook.addWorksheet('Line details', {
		views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }],
		pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
	});
	const columns = [
		['RUN SHEET', 28],
		['EMPLOYEE CODE', 16],
		['NAME', 30],
		['RUN PERIOD', 16],
		['LINE PERIOD', 16],
		['SOURCE', 32],
		['CATALOGUE CODE', 24],
		['DESCRIPTION', 36],
		['PARTY', 16],
		['SUBTOTAL', 24],
		['DIRECTION', 16],
		['QUANTITY', 14],
		['UNIT', 14],
		['AMOUNT', 16],
		['CURRENCY', 12],
		['COMPANY', 28]
	] as const;
	ws.columns = columns.map(([header, width]) => ({ header, width }));
	for (const { sheet, name } of sheets)
		for (const person of sheet.people)
			for (const line of person.breakdown.lines) {
				const row = ws.addRow([
					name,
					person.code,
					person.name,
					sheet.period,
					line.period ?? line.back_pay_period ?? sheet.period,
					line.source,
					line.code,
					line.label,
					line.party,
					line.subtotal,
					line.direction,
					line.quantity ?? null,
					line.unit ?? '',
					signed(line),
					sheet.currency,
					sheet.company
				]);
				row.getCell(12).numFmt = '0.####';
				row.getCell(14).numFmt = ACCOUNTING;
			}
	ws.getRow(1).height = 32;
	ws.getRow(1).eachCell((cell) => {
		cell.font = { bold: true };
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IDENTITY_FILL } };
		cell.alignment = { vertical: 'middle', wrapText: true };
	});
	ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: columns.length } };
};

/** The listing of these runs and their saved line details as one workbook. */
export const workbookOf = (sheets: readonly Sheet[]) => {
	const workbook = new ExcelJSBrowser.Workbook();
	workbook.creator = 'Payroll';
	const taken = new Set<string>(['line details']);
	const named = sheets.map((sheet) => ({
		sheet,
		name: sheetName(`${monthOf(sheet.period)}${sheet.offCycle ? ' OFF-CYCLE' : ''}`, taken)
	}));
	for (const { sheet, name } of named) addSheet(workbook, sheet, name);
	addDetails(workbook, named);
	return workbook;
};
