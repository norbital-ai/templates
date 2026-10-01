/**
 * Declared returns and bank files (L2), generated from settled payslips.
 *
 * A declaration (`datatypes/returns.ts`) states every cell as an expression over the `filing` site;
 * this module groups the slips into rows, evaluates the population and the cells, and writes the
 * bytes the format names. Nothing is recomputed: every figure is read back from what the payslips
 * stored, through `loadRunExports`, so a return, the bank file and the workbook never disagree.
 */

import { EXPRESSION_CONTEXTS } from '../../expressions/contexts.js';
import {
	evaluateBoolean,
	evaluateExpression,
	expressionEngine
} from '../../expressions/evaluate.js';
import {
	RETURN_CADENCES,
	returnsOf,
	type ReturnColumn,
	type ReturnDeclaration
} from '../../datatypes/returns.js';
import { refuse } from '../../refuse.js';
import { cents } from './rounding.js';
import type { ReportPayslip } from './report.js';
import * as Predicate from 'effect/Predicate';
import { loadRunExports, type PayerAccount } from './export-data.js';
import { readAll, type Reads } from '../../reads.js';
import type { WorkspaceRow } from '../../rows.js';
import { decodeNumber } from '../../wire.js';
import { calendarOccurrences } from '../../obligations/materialise.js';

type Money = Record<string, number>;

/** One settled payslip as the filing site reads it. */
export type FilingSlip = {
	readonly period: string;
	readonly pay_date: string;
	readonly gross: number;
	readonly net: number;
	readonly lines: Money;
	readonly classes: Money;
	readonly base: Money;
	readonly employee: Money;
	readonly employer: Money;
};

/** Who a row is about: the identity a return files under. */
export type FilingPayee = {
	readonly employee_id: string;
	readonly employment_id: string;
	readonly employee_number: string;
	readonly name: string;
	readonly identity_number: string;
	readonly nationality: string;
	readonly designation: string;
	readonly department: string;
	readonly gender: string;
	readonly birth_date: string;
	readonly hire_date: string;
	readonly last_day: string;
	readonly departure_on: string;
};

export type FilingAccount = {
	readonly code: string;
	readonly account: string;
	readonly holder: string;
};

/** One row before evaluation: a person (a payment, for a bank file) and the slips it covers, oldest first. */
export type FilingGroup = {
	readonly payee: FilingPayee;
	readonly bank: FilingAccount | null;
	readonly slips: readonly FilingSlip[];
};

export type FilingInput = {
	readonly declaration: ReturnDeclaration;
	readonly filing: {
		readonly code: string;
		readonly period: string;
		readonly year: number;
		readonly pay_date: string;
	};
	readonly company: {
		readonly settings_code: string;
		readonly name: string;
		readonly facts: Readonly<Record<string, unknown>>;
	};
	readonly payer: (FilingAccount & { readonly bank_name: string }) | null;
	readonly groups: readonly FilingGroup[];
	readonly currency?: string | undefined;
};

export type GeneratedFile = {
	readonly name: string;
	readonly mime: string;
	/** Every record's cells, header and trailer records included: what an XLSX writes. */
	readonly table: readonly (readonly (string | number)[])[];
	/** CSV and FIXED: the file's text. */
	readonly text: string | null;
	/** Detail rows the file carries. */
	readonly rows: number;
};

/** Signs a line by its bucket: an absence or a deduction takes money off. */
const SUBTRACTS: ReadonlySet<string> = new Set(['ABSENCE', 'DEDUCTION']);

const add = (into: Money, key: string, amount: number) => {
	into[key] = (into[key] ?? 0) + amount;
};

/** A settled payslip as the filing site reads it: lines by code, classes by family and bucket, charges by scheme. */
export function filingSlip(period: string, payDate: string, payslip: ReportPayslip): FilingSlip {
	const lines: Money = {};
	const classes: Money = {};
	for (const line of payslip.lines) {
		const amount = SUBTRACTS.has(line.bucket) ? -line.amount : line.amount;
		add(lines, line.componentCode, amount);
		// ponytail: classes are the line's family and bucket; the catalogue's class tags when E5 lands.
		add(classes, line.family, amount);
		add(classes, line.bucket, amount);
	}
	const base: Money = {};
	const employee: Money = {};
	const employer: Money = {};
	for (const [scheme, charge] of payslip.contributions) {
		base[scheme] = charge.base;
		employee[scheme] = charge.employee;
		employer[scheme] = charge.employer;
	}
	return {
		period,
		pay_date: payDate,
		gross: payslip.gross,
		net: payslip.net,
		lines,
		classes,
		base,
		employee,
		employer
	};
}

const MAPS = ['lines', 'classes', 'base', 'employee', 'employer'] as const;
const MONEY_MENTION = /\.(lines|classes|base|employee|employer)\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Every money key the declaration's expressions name, per map: a row without that line reads 0, not a
 * missing-key fault. (A person-site `employee.gender` lands a harmless zero on the money map too.)
 */
function mentionedMoney(declaration: ReturnDeclaration): Record<(typeof MAPS)[number], string[]> {
	const text = [
		declaration.population ?? '',
		declaration.format.name ?? '',
		...[
			...declaration.columns,
			...(declaration.header_records ?? []).flatMap((record) => record.columns),
			...(declaration.trailer_records ?? []).flatMap((record) => record.columns)
		].map((column) => column.value)
	].join('\n');
	const out = Object.fromEntries(MAPS.map((name) => [name, [] as string[]])) as Record<
		(typeof MAPS)[number],
		string[]
	>;
	for (const [, map, key] of text.matchAll(MONEY_MENTION))
		out[map as (typeof MAPS)[number]].push(key!);
	return out;
}

/** The slip with every mentioned key present. */
const filled = (slip: FilingSlip, keys: Record<(typeof MAPS)[number], string[]>): FilingSlip => ({
	...slip,
	...Object.fromEntries(
		MAPS.map((name) => [
			name,
			{ ...Object.fromEntries(keys[name].map((key) => [key, 0])), ...slip[name] }
		])
	)
});

/** The slips summed, each total rounded to the currency. */
function totalsOf(
	slips: readonly FilingSlip[],
	currency: string | undefined,
	keys: Record<(typeof MAPS)[number], string[]>
) {
	const sum = (pick: (slip: FilingSlip) => number) =>
		cents(
			slips.reduce((total, slip) => total + pick(slip), 0),
			currency
		);
	const maps = Object.fromEntries(
		MAPS.map((name) => {
			const into: Money = Object.fromEntries(keys[name].map((key) => [key, 0]));
			for (const slip of slips)
				for (const [key, value] of Object.entries(slip[name])) add(into, key, value);
			return [
				name,
				Object.fromEntries(Object.entries(into).map(([k, v]) => [k, cents(v, currency)]))
			];
		})
	);
	return {
		gross: sum((slip) => slip.gross),
		net: sum((slip) => slip.net),
		...maps,
		slips: slips.length
	};
}

const BLANK_PAYEE: FilingPayee & { identity_type: string } = {
	employee_id: '',
	employment_id: '',
	employee_number: '',
	name: '',
	identity_number: '',
	identity_type: '',
	nationality: '',
	designation: '',
	department: '',
	gender: '',
	birth_date: '',
	hire_date: '',
	last_day: '',
	departure_on: ''
};

/** The person site's blank with what a settled payslip knows filled in. */
function personOf(payee: FilingPayee | null) {
	const person = structuredClone(EXPRESSION_CONTEXTS.filing.blank.person) as {
		employee: Record<string, unknown>;
		employment: Record<string, unknown>;
		terms: Record<string, unknown>;
	};
	if (payee == null) return person;
	// ponytail: the payslip's own identity only; the run's full person context when a return reads more of it.
	person.employee.gender = payee.gender;
	person.employee.birth_date = payee.birth_date;
	person.employment.service_start = payee.hire_date;
	person.employment.exit_date = payee.last_day;
	person.terms.department = payee.department;
	return person;
}

/**
 * The identification type, read from the number by the declared patterns. A row the file carries
 * cannot be filed on any other, so it is refused (`strict`); the population reads it as blank.
 */
function identityType(declaration: ReturnDeclaration, payee: FilingPayee, strict: boolean): string {
	const patterns = declaration.identity_patterns ?? [];
	if (patterns.length === 0) return '';
	const number = payee.identity_number.trim().toUpperCase();
	const type = patterns.find((row) => new RegExp(row.pattern).test(number))?.type;
	return (
		type ??
		(!strict
			? ''
			: refuse(
					`${payee.employee_number}: ${declaration.code} identifies the employee by ${patterns.map((row) => row.type).join(' or ')}; record the identity number before filing.`
				))
	);
}

/** One cell's value as text, checked against its pattern. */
function cell(declaration: ReturnDeclaration, column: ReturnColumn, context: object, row: number) {
	const value = evaluateExpression(expressionEngine, column.value, context);
	const text =
		value == null
			? ''
			: Predicate.isString(value)
				? value
				: Predicate.isNumber(value) || Predicate.isBigInt(value)
					? String(value)
					: refuse(
							`${declaration.code} ${column.key}: the value is ${String(value)}, not text or a number.`
						);
	if (column.pattern != null && !new RegExp(column.pattern).test(text))
		refuse(
			`${declaration.code} ${column.key} (row ${row}): "${text}" does not match the declared layout.`
		);
	return Predicate.isNumber(value) ? value : text;
}

/** A fixed-width field, refusing a value that would shift every field after it. */
function field(declaration: ReturnDeclaration, column: ReturnColumn, value: string, row: number) {
	const width = column.width!;
	if (value.length > width && column.truncate !== true)
		refuse(
			`${declaration.code} ${column.key} (row ${row}): "${value}" is longer than its ${width} characters.`
		);
	const cut = value.slice(0, width);
	const pad = column.pad ?? ' ';
	return column.align === 'RIGHT' ? cut.padStart(width, pad) : cut.padEnd(width, pad);
}

const quoted = (text: string, delimiter: string) =>
	text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

const EXTENSION = { CSV: 'csv', XLSX: 'xlsx', FIXED: 'txt' } as const;
const MIME = {
	CSV: 'text/csv',
	XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	FIXED: 'text/plain'
} as const;

/** The declared file: its population, rows, records and bytes. Pure. */
export function generateReturn(input: FilingInput): GeneratedFile {
	const { declaration, currency } = input;
	const format = declaration.format;
	const keys = mentionedMoney(declaration);
	const groups = input.groups.map((group) => ({
		...group,
		slips: group.slips.map((slip) => filled(slip, keys))
	}));
	const base = {
		company: input.company,
		payer: input.payer ?? { code: '', account: '', holder: '', bank_name: '' }
	};
	const rowContext = (
		group: FilingGroup | null,
		slips: readonly FilingSlip[],
		index: number,
		rows: number,
		strict = true
	) => ({
		...base,
		filing: { ...input.filing, rows },
		row: { index },
		person: personOf(group?.payee ?? null),
		payee:
			group == null
				? BLANK_PAYEE
				: { ...group.payee, identity_type: identityType(declaration, group.payee, strict) },
		bank: group?.bank ?? { code: '', account: '', holder: '' },
		totals: totalsOf(slips, currency, keys),
		slips
	});
	const population = declaration.population?.trim();
	const included = groups.filter(
		(group, index) =>
			!population ||
			evaluateBoolean(
				expressionEngine,
				population,
				rowContext(group, group.slips, index + 1, 0, false)
			)
	);
	const rows = included.length;
	const file = rowContext(
		null,
		included.flatMap((group) => group.slips),
		0,
		rows
	);
	const evaluate = (columns: readonly ReturnColumn[], context: object, row: number) =>
		columns.map((column) => ({ column, value: cell(declaration, column, context, row) }));
	const records = [
		...(declaration.header_records ?? []).map((record) => evaluate(record.columns, file, 0)),
		...(format.header === true && format.kind !== 'FIXED'
			? [declaration.columns.map((column) => ({ column, value: column.label ?? column.key }))]
			: []),
		...included.map((group, index) =>
			evaluate(declaration.columns, rowContext(group, group.slips, index + 1, rows), index + 1)
		),
		...(declaration.trailer_records ?? []).map((record) => evaluate(record.columns, file, 0))
	];
	const table = records.map((record) => record.map(({ value }) => value));
	const delimiter = format.delimiter ?? ',';
	const end =
		(format.line_end ?? (format.kind === 'CSV' ? 'CRLF' : 'LF')) === 'CRLF' ? '\r\n' : '\n';
	const lines =
		format.kind === 'FIXED'
			? records.map((record, row) =>
					record.map(({ column, value }) => field(declaration, column, String(value), row)).join('')
				)
			: records.map((record) =>
					record.map(({ value }) => quoted(String(value), delimiter)).join(delimiter)
				);
	const text =
		format.kind === 'XLSX' ? null : lines.join(end) + (format.final_line_end === true ? end : '');
	if (format.encoding === 'ASCII' && /[^\x00-\x7f]/.test(text ?? JSON.stringify(table)))
		refuse(`${declaration.code}: the file is ASCII; a value carries a character outside it.`);
	const named = format.name?.trim();
	const name = named
		? String(evaluateExpression(expressionEngine, named, file))
		: `${declaration.code.toLowerCase()}_${input.filing.period}.${EXTENSION[format.kind]}`;
	return { name, mime: MIME[format.kind], table, text, rows };
}

/** The payee a payslip names, as the filing site reads it. */
export function filingPayee(payslip: ReportPayslip): FilingPayee {
	return {
		employee_id: payslip.person.employeeId,
		employment_id: payslip.employmentId,
		employee_number: payslip.employeeNumber,
		name: payslip.employeeName,
		identity_number: payslip.identityNumber ?? '',
		nationality: payslip.person.nationality ?? '',
		designation: payslip.designation ?? '',
		department: payslip.section ?? '',
		gender: payslip.person.gender ?? '',
		birth_date: payslip.person.dateOfBirth ?? '',
		hire_date: payslip.hireDate,
		last_day: payslip.lastDay ?? '',
		departure_on: payslip.person.departureOn ?? ''
	};
}

/**
 * The rows of a filing: one per person for a return (their slips of the scope, the latest slip's
 * identity), one per payment for a bank file (`byEmployment`), ordered by employee number.
 */
export function filingGroups(
	runs: readonly {
		readonly period: string;
		readonly payDate: string;
		readonly payslips: readonly ReportPayslip[];
		readonly bank: readonly {
			readonly employmentId: string;
			readonly bank: {
				readonly bank_code: string;
				readonly account_number: string;
				readonly account_name: string;
			};
		}[];
	}[],
	byEmployment: boolean
): FilingGroup[] {
	const groups = new Map<
		string,
		{ payee: FilingPayee; bank: FilingAccount | null; slips: FilingSlip[] }
	>();
	for (const run of runs.toSorted((a, b) =>
		a.period < b.period ? -1 : a.period > b.period ? 1 : 0
	))
		for (const payslip of run.payslips) {
			const destination = run.bank.find((row) => row.employmentId === payslip.employmentId);
			// A bank file pays only the slips with a destination; the export names the rest.
			if (byEmployment && destination == null) continue;
			const key = byEmployment ? payslip.employmentId : payslip.person.employeeId;
			const group = groups.get(key) ?? { payee: filingPayee(payslip), bank: null, slips: [] };
			group.payee = filingPayee(payslip);
			if (destination != null)
				group.bank = {
					code: destination.bank.bank_code,
					account: destination.bank.account_number,
					holder: destination.bank.account_name
				};
			group.slips.push(filingSlip(run.period, run.payDate, payslip));
			groups.set(key, group);
		}
	return [...groups.values()].toSorted((a, b) =>
		a.payee.employee_number < b.payee.employee_number
			? -1
			: a.payee.employee_number > b.payee.employee_number
				? 1
				: 0
	);
}

/** The filing's scope key: the run's period, the month, the quarter (`2026-Q1`) or the year — the duty ledger's refs. */
export function filingPeriod(cadence: ReturnDeclaration['cadence'], runPeriod: string): string {
	if (cadence === 'EVENT') return runPeriod;
	if (cadence === 'MONTH') return runPeriod.slice(0, 7);
	if (cadence === 'YEAR') return runPeriod.slice(0, 4);
	const month = `${runPeriod.slice(0, 7)}-01`;
	return calendarOccurrences(cadence, month, month)[0]!.ref;
}

/** The bank-file declaration governing a payer, or null: the export then keeps its generic listing. */
export const bankFileDeclaration = (
	declarations: readonly ReturnDeclaration[],
	payerBankCode: string
): ReturnDeclaration | null =>
	declarations.find(
		(row) => row.payer_bank != null && new RegExp(row.payer_bank, 'i').test(payerBankCode.trim())
	) ?? null;

type RunRow = Parameters<typeof loadRunExports>[1][number];

/** One generated return, with the scope it covers: what the export saves and evidences. */
export type Filing = {
	readonly declaration: ReturnDeclaration;
	readonly companyId: string;
	readonly settingsId: string;
	readonly period: string;
	readonly runIds: readonly string[];
	readonly file: GeneratedFile;
};

const byPeriod = (a: { period: string }, b: { period: string }) =>
	a.period < b.period ? -1 : a.period > b.period ? 1 : 0;

/** The settings versions the runs cite, with their declarations and currency. */
export async function returnVersions(reads: Reads, settingsIds: readonly string[]) {
	const rows =
		settingsIds.length === 0
			? []
			: await readAll<{ id: string; returns?: unknown; payroll?: { currency?: string } | null }>(
					reads,
					'jurisdiction_settings',
					{ id: { in: [...new Set(settingsIds)] } },
					undefined,
					// ponytail: `returns` lands on the settings model with package T; untyped until then.
					{ id: true, returns: true, payroll: true } as never
				);
	return new Map(rows.map((row) => [row.id, row]));
}

/** The payer account a run's export carries, as the filing site reads it. */
export const filingPayer = (payer: PayerAccount | null) =>
	payer == null
		? null
		: {
				code: payer.bank_code,
				account: payer.bank_account_number,
				holder: payer.bank_account_name,
				bank_name: payer.bank_name
			};

/**
 * The declared returns (not bank files) the selected runs ask for: for every run, each return of its
 * cadence — the run itself, its month, its year — under the version of the scope's latest run, over
 * every settled run of the entity in that scope. A held slip may still be re-priced, so a scope
 * holding one is refused rather than filed short. `codes` narrows the declarations.
 */
export async function loadReturns(
	reads: Reads,
	selected: readonly (RunRow & { readonly company_id: string })[],
	codes?: readonly string[]
): Promise<Filing[]> {
	const out: Filing[] = [];
	for (const [companyId, chosen] of Map.groupBy(selected, (run) => run.company_id)) {
		const years = chosen.map((run) => run.period.slice(0, 4)).toSorted();
		const [company] = await readAll<WorkspaceRow<'companies'>>(reads, 'companies', {
			id: { in: [companyId] }
		});
		const scope = await readAll<RunRow & { readonly company_id: string }>(reads, 'payroll_runs', {
			company_id: { in: [companyId] },
			period: { gte: `${years[0]}-01`, lte: `${years.at(-1)}-12-9` }
		});
		const versions = await returnVersions(
			reads,
			scope.map((run) => run.settings_id)
		);
		const wanted = new Map<
			string,
			{ declaration: ReturnDeclaration; period: string; runs: RunRow[] }
		>();
		for (const run of chosen)
			for (const cadence of RETURN_CADENCES) {
				const period = filingPeriod(cadence, run.period);
				const runs =
					cadence === 'EVENT'
						? [run]
						: scope
								.filter((row) => filingPeriod(cadence, row.period) === period)
								.toSorted(byPeriod);
				const governing = runs.at(-1)!;
				for (const declaration of returnsOf(versions.get(governing.settings_id)))
					if (
						declaration.cadence === cadence &&
						declaration.payer_bank == null &&
						(codes == null || codes.includes(declaration.code))
					)
						wanted.set(`${declaration.code}\u0000${period}`, { declaration, period, runs });
			}
		if (wanted.size === 0) continue;
		const needed = [
			...new Map(
				[...wanted.values()].flatMap((row) => row.runs).map((run) => [run.id, run])
			).values()
		];
		const held = await readAll<WorkspaceRow<'payslips'>>(reads, 'payslips', {
			payroll_run_id: { in: needed.map((run) => run.id) },
			status: { eq: 'ON_HOLD' }
		});
		const exports = await loadRunExports(reads, needed);
		for (const { declaration, period, runs } of wanted.values()) {
			const ids = new Set(runs.map((run) => run.id));
			const holding = held.filter((slip) => ids.has(slip.payroll_run_id)).length;
			if (holding > 0)
				refuse(
					`${holding} payslip(s) of ${period} are on hold; settle or release them before building ${declaration.code}.`
				);
			const scoped = exports.filter((run) => ids.has(run.runId));
			const governing = runs.at(-1)!;
			const last = scoped.find((run) => run.runId === governing.id)!;
			const version = versions.get(governing.settings_id);
			out.push({
				declaration,
				companyId,
				settingsId: governing.settings_id,
				period,
				runIds: [...ids],
				file: generateReturn({
					declaration,
					filing: {
						code: declaration.code,
						period,
						year: decodeNumber(period.slice(0, 4)),
						pay_date: last.payDate
					},
					company: {
						settings_code: company?.settings_code ?? '',
						name: company?.name ?? '',
						facts: (company?.facts as Record<string, unknown> | null | undefined) ?? {}
					},
					payer: filingPayer(last.payer),
					groups: filingGroups(scoped, false),
					currency: version?.payroll?.currency
				})
			});
		}
	}
	return out;
}
