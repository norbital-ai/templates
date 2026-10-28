import { Array as EffectArray } from 'effect';
/**
 * L-TPL-hr-payroll-137: a bank payment CSV plus one payslip CSV per employee. Held slips and non-positive nets are
 * omitted from the bank file. A bank's own layout (a fixed-width bulk payment file) and every statutory return are
 * records (`recordDocuments`).
 */
import { Decimal } from '@norbital-ai/std/decimal';
import { Result, Schema } from 'effect';
import { ExportRules, type ExportField } from '../bank_template.js';
import { evaluateConfigured } from './expressions.js';
import {
	isJsonObject,
	type Json,
	type JsonObject,
	numberOf,
	celValues,
	Refusal
} from './foundation.js';
import { FAMILIES } from './payslip/context.js';

const isString = Schema.is(Schema.String);

type BankAccount = {
	readonly bank_name?: string;
	readonly bank_code?: string;
	readonly bank_account_number?: string;
	readonly bank_account_name?: string;
};

export type ExportPayment = {
	readonly employee_number: string;
	readonly name: string;
	readonly bank: BankAccount | null;
	readonly amount: string;
	readonly currency: string;
	readonly status: string;
	readonly period: string;
	readonly gross: string;
	readonly total_deductions: string;
	readonly lines: readonly { readonly component_code: string; readonly amount: string }[];
};

export type ExportDocument = { readonly name: string; readonly content: string };

export function bankAccountFrom(value: unknown): BankAccount | null {
	if (!isJsonObject(value)) return null;
	return {
		...(isString(value.bank_name) ? { bank_name: value.bank_name } : {}),
		...(isString(value.bank_code) ? { bank_code: value.bank_code } : {}),
		...(isString(value.bank_account_number)
			? { bank_account_number: value.bank_account_number }
			: {}),
		...(isString(value.bank_account_name) ? { bank_account_name: value.bank_account_name } : {})
	};
}

export function moneyText(value: unknown): string {
	if (value instanceof Decimal) return value.toString();
	if (Schema.is(Schema.Number)(value) || isString(value)) {
		// A plain number reads through its shortest decimal text: Decimal.of takes only integer numbers.
		return Result.getOrElse(
			Result.try(() =>
				Decimal.of(Schema.is(Schema.Number)(value) ? String(value) : value).toString()
			),
			() => '0'
		);
	}
	return '0';
}

export function payable(status: string, net: unknown): boolean {
	if (status === 'ON_HOLD') return false;
	return Decimal.of(moneyText(net)).cmp(0) > 0;
}

export function payslipLines(
	value: unknown
): { readonly component_code: string; readonly amount: string }[] {
	if (!EffectArray.isArray(value)) return [];
	const out: { readonly component_code: string; readonly amount: string }[] = [];
	for (const row of value) {
		if (!isJsonObject(row)) continue;
		// A statutory line: the employee share, deducted (an employer-only charge is not on the employee's slip).
		if (isString(row.scheme_code)) {
			const share = Decimal.of(moneyText(row.employee_amount));
			if (share.cmp(0) !== 0)
				out.push({ component_code: row.scheme_code, amount: share.neg().toString() });
			continue;
		}
		const code = isString(row.component_code)
			? row.component_code
			: isString(row.code)
				? row.code
				: '';
		if (code === '') continue;
		out.push({ component_code: code, amount: moneyText(row.amount) });
	}
	return out;
}

function csvEscape(value: string): string {
	if (!/[",\n]/.test(value)) return value;
	return `"${value.replaceAll('"', '""')}"`;
}

function csvRow(cells: readonly string[]): string {
	return cells.map(csvEscape).join(',');
}

function bankCsv(payments: readonly ExportPayment[]): string {
	return [
		csvRow([
			'employee_number',
			'name',
			'bank_code',
			'account',
			'account_name',
			'amount',
			'currency'
		]),
		...payments.map((row) =>
			csvRow([
				row.employee_number,
				row.name,
				row.bank?.bank_code ?? '',
				row.bank?.bank_account_number ?? '',
				row.bank?.bank_account_name ?? '',
				row.amount,
				row.currency
			])
		)
	].join('\n');
}

export function bankDocument(
	period: string,
	payments: readonly ExportPayment[]
): ExportDocument | null {
	const rows = payments.filter((row) => payable(row.status, row.amount));
	if (rows.length === 0) return null;
	return { name: `bank-${period}.csv`, content: bankCsv(rows) };
}

export function payslipDocument(row: ExportPayment): ExportDocument {
	const lines = [
		csvRow(['field', 'value']),
		csvRow(['period', row.period]),
		csvRow(['employee_number', row.employee_number]),
		csvRow(['name', row.name]),
		csvRow(['currency', row.currency]),
		csvRow(['gross', row.gross]),
		csvRow(['total_deductions', row.total_deductions]),
		csvRow(['net', row.amount]),
		csvRow(['status', row.status]),
		csvRow(['component_code', 'amount']),
		...row.lines.map((line) => csvRow([line.component_code, line.amount]))
	];
	return {
		name: `payslip-${row.employee_number}-${row.period}.csv`,
		content: lines.join('\n')
	};
}

/**
 * The bank file and one payslip file per payment. `scale` is the currency's minor units (IDR 0, SGD 2: the version's
 * `payroll.minor_units`, else the currency's own): every amount prints at it, never at the column's two places.
 */
export function payrollExportDocuments(input: {
	readonly period: string;
	readonly payments: readonly ExportPayment[];
	readonly scale?: number;
}): ExportDocument[] {
	const { scale } = input;
	const at = (amount: string) =>
		scale === undefined ? amount : Decimal.of(amount).round(scale).toString();
	const payments = input.payments.map((row) => ({
		...row,
		amount: at(row.amount),
		gross: at(row.gross),
		total_deductions: at(row.total_deductions),
		lines: row.lines.map((line) => ({ ...line, amount: at(line.amount) }))
	}));
	const bank = bankDocument(input.period, payments);
	return [...(bank == null ? [] : [bank]), ...payments.map(payslipDocument)];
}

/** One employment's slips over the selected runs and the entries they pinned, as a return's row reads it. */
type ExportRow = {
	readonly employee: JsonObject;
	readonly contract: JsonObject;
	readonly slips: readonly JsonObject[];
	readonly entries?: readonly JsonObject[];
};

/** The contract term (`contract.facts.contract_terms`) in force on `day`, else `{}`. */
const termOn = (contract: JsonObject, day: string): JsonObject =>
	(isJsonObject(contract.facts) && EffectArray.isArray(contract.facts.contract_terms)
		? contract.facts.contract_terms.filter(isJsonObject)
		: []
	)
		.filter((term) => {
			const range = isJsonObject(term.effective_range) ? term.effective_range : {};
			const to = range.to == null || range.to === '' ? null : String(range.to);
			return String(range.from ?? '') <= day && (to === null || to >= day);
		})
		.toSorted((a, b) =>
			String(isJsonObject(a.effective_range) ? a.effective_range.from : '').localeCompare(
				String(isJsonObject(b.effective_range) ? b.effective_range.from : '')
			)
		)
		.at(-1) ?? {};

const sum = (values: readonly unknown[]): number =>
	Math.round(values.reduce<number>((total, value) => total + (numberOf(value) ?? 0), 0) * 100) /
	100;

/** The slips summed: `gross`, `net`, `total_deductions`, `lines.<CODE>`, `statutory.<SCHEME>.{employee, employer, base}`. */
const totalsOf = (slips: readonly JsonObject[]): JsonObject => {
	const lines: { [code: string]: number } = {};
	const statutory: { [code: string]: { employee: number; employer: number; base: number } } = {};
	for (const slip of slips) {
		const held = slip['lines'];
		if (isJsonObject(held))
			for (const [code, value] of Object.entries(held)) lines[code] = sum([lines[code], value]);
		const charged = slip['statutory'];
		if (isJsonObject(charged))
			for (const [code, value] of Object.entries(charged)) {
				if (!isJsonObject(value)) continue;
				const prior = statutory[code] ?? { employee: 0, employer: 0, base: 0 };
				statutory[code] = {
					employee: sum([prior.employee, value['employee']]),
					employer: sum([prior.employer, value['employer']]),
					base: sum([prior.base, value['base']])
				};
			}
	}
	return {
		gross: sum(slips.map((slip) => slip['gross'])),
		net: sum(slips.map((slip) => slip['net'])),
		total_deductions: sum(slips.map((slip) => slip['total_deductions'])),
		lines,
		statutory
	};
};

/**
 * Each export layout (an `EXPORTS` row shaped as `ExportRules`) rendered as one CSV over the selected runs: a row per employment, read on `runs[]`,
 * `employee`, `contract`, `slips[]` and their `totals`. New returns are records; this renders them.
 */
export function recordDocuments(
	templates: readonly { readonly code: string; readonly rules: unknown }[],
	runs: readonly JsonObject[],
	rows: readonly ExportRow[],
	/** The runs' entity, its facts included: every record reads it as `company`. */
	company: JsonObject = {},
	/** The instant the file is made (the caller's clock): every record reads it as `generated_at`. */
	generated_at: string = '',
	/** Bank output must refuse overflow instead of changing an account or amount by truncation. */
	strict: boolean = false,
	/** The admitted bank file's payment currency, available to configured layout predicates. */
	currency: string = ''
): ExportDocument[] {
	// Each row reads its contract term in force on the selected runs' last day as `terms`, as a payslip does.
	const lastDay = runs
		.map((run) => String(run.salary_to ?? ''))
		.reduce((last, day) => (day > last ? day : last), '');
	return templates.flatMap((template) => {
		if (!Schema.is(ExportRules)(template.rules)) return [];
		const rules = template.rules;
		if (
			rules.applies_when != null &&
			evaluateConfigured(rules.applies_when, { runs, company, currency, generated_at }) !== true
		)
			return [];
		const fixed = rules.format === 'FIXED';
		const record = (fields: readonly ExportField[], context: JsonObject): string => {
			const cells = fields.map((field) => {
				const value = evaluateConfigured(field.value, context);
				const text = value == null ? '' : String(value);
				if (strict && /[\u0000-\u001f\u007f]/.test(text))
					throw new Refusal({
						message: `The bank layout ${template.code} contains a control character in ${field.header ?? 'a field'}. Correct the value before exporting.`
					});
				if (!fixed || field.width == null) return text;
				const width = Math.max(0, field.width);
				if (strict && (!Number.isInteger(width) || width < 1 || text.length > width))
					throw new Refusal({
						message: `The bank layout ${template.code} cannot fit ${field.header ?? 'a field'} in its configured width. Correct the value or bank layout before exporting.`
					});
				const pad = (field.pad ?? ' ').slice(0, 1) || ' ';
				if (strict && /[\u0000-\u001f\u007f]/.test(pad))
					throw new Refusal({ message: 'The bank layout uses an invalid padding character.' });
				return field.align === 'right'
					? text.slice(-width).padStart(width, pad)
					: text.slice(0, width).padEnd(width, pad);
			});
			return fixed ? cells.join('') : csvRow(cells);
		};
		const listed = rows
			.map((row): JsonObject => ({
				...row,
				terms: termOn(row.contract, lastDay),
				entries: row.entries ?? [],
				runs,
				company,
				currency,
				generated_at,
				totals: totalsOf(row.slips)
			}))
			.filter((context) => rules.when == null || evaluateConfigured(rules.when, context) === true)
			.map((context, i): JsonObject => ({ ...context, index: i + 1 }));
		if (strict && listed.length !== rows.length)
			throw new Refusal({
				message: 'The bank layout excludes a payable employee. Correct the layout before exporting.'
			});
		// Each row's records: one per row (`columns`), or one per `item` of each record type's `each` list.
		const items = listed.flatMap(
			(context): { fields: readonly ExportField[]; context: JsonObject }[] =>
				rules.records == null
					? [{ fields: rules.columns, context }]
					: rules.records.flatMap((type) => {
							const each = evaluateConfigured(type.each, context);
							return (EffectArray.isArray<typeof each>(each) ? each : []).map((item: Json) => ({
								fields: type.fields,
								context: { ...context, item }
							}));
						})
		);
		const contexts = items.map((held) => held.context);
		const framing: JsonObject = {
			runs,
			company,
			currency,
			generated_at,
			rows: listed,
			items: contexts,
			count: listed.length,
			entries: rows.flatMap((row) => row.entries ?? [])
		};
		const summary = rules.summary;
		// The summary's items: its own list when it names one, else the detail records.
		const sources: JsonObject[] =
			summary?.each == null
				? contexts
				: (() => {
						const each = evaluateConfigured(summary.each, framing);
						return (EffectArray.isArray<typeof each>(each) ? each : []).map((item: Json) => ({
							...framing,
							item
						}));
					})();
		const groups = new Map<string, JsonObject[]>();
		if (summary != null)
			for (const context of sources) {
				const key = String(evaluateConfigured(summary.key, context));
				groups.set(key, [...(groups.get(key) ?? []), context]);
			}
		const summaries =
			summary == null
				? []
				: [...groups].map(([key, group]) =>
						record(summary.fields, {
							runs,
							company,
							currency,
							generated_at,
							key,
							items: group,
							count: group.length
						})
					);
		const before = summary?.position === 'before';
		return [
			{
				name: String(evaluateConfigured(rules.file, { runs, company, currency, generated_at })),
				content: [
					...(fixed ? [] : [csvRow(rules.columns.map((column) => column.header ?? ''))]),
					...(rules.header == null ? [] : [record(rules.header, framing)]),
					...(before ? summaries : []),
					...items.map((held) => record(held.fields, held.context)),
					...(before ? [] : summaries),
					...(rules.trailer == null ? [] : [record(rules.trailer, framing)])
				].join('\n')
			}
		];
	});
}

/** A stored row as plain JSON for a return's CEL (decimals and dates as their wire values). */
export const plainRow = (row: unknown): JsonObject => {
	const held = celValues(row ?? {});
	return isJsonObject(held) ? held : {};
};

/** A pinned entry as the payslip's relation arm reads it: its class code through `catalog`. */
type PinnedEntry = {
	readonly employment_id?: unknown;
	readonly catalog?: { readonly code?: unknown } | null;
	readonly amount?: unknown;
	readonly quantity?: unknown;
	readonly days?: unknown;
	readonly from?: unknown;
	readonly to?: unknown;
	readonly facts?: unknown;
};
/** A payslip with the entries it pinned, one arm per entry model. */
type PinningSlip = {
	readonly [C in (typeof FAMILIES)[number]['collection']]?: readonly PinnedEntry[];
};

const codeOf = (entry: PinnedEntry): string =>
	isString(entry.catalog?.code) ? entry.catalog.code : '';
const nullableNumber = (value: unknown): number | null =>
	value == null ? null : Number(moneyText(value));

/**
 * The entries the slips pinned, as a return's `entries[]` reads them (per-item returns: one record per residence,
 * per plan): `family`, `code`, `amount`, `quantity`, `facts`, `employment_id`.
 */
export function exportEntries(slips: readonly PinningSlip[]): JsonObject[] {
	return slips.flatMap((slip) =>
		FAMILIES.flatMap(({ collection, family }) =>
			(slip[collection] ?? []).map((entry): JsonObject => ({
				family,
				code: codeOf(entry),
				amount: Number(moneyText(entry.amount)),
				quantity: nullableNumber(entry.quantity),
				facts: plainRow(entry.facts),
				employment_id: isString(entry.employment_id) ? entry.employment_id : null
			}))
		)
	);
}

/** One stored payslip as a return's `slips[]` reads it: its totals, lines by code, scheme charges and leave rows. */
export function exportSlip(
	slip: PinningSlip & {
		readonly gross?: unknown;
		readonly net?: unknown;
		readonly total_deductions?: unknown;
		readonly status?: unknown;
		readonly base?: unknown;
		readonly adjustments?: unknown;
		readonly statutory?: unknown;
	},
	period: string
): JsonObject {
	const lines: { [code: string]: number } = {};
	for (const line of [...payslipLines(slip.base), ...payslipLines(slip.adjustments)])
		lines[line.component_code] = Number(
			Decimal.of(lines[line.component_code] ?? 0)
				.plus(line.amount)
				.toString()
		);
	const statutory: { [code: string]: JsonObject } = {};
	for (const line of EffectArray.isArray(slip.statutory) ? slip.statutory : []) {
		if (!isJsonObject(line) || !isString(line.scheme_code)) continue;
		statutory[line.scheme_code] = {
			employee: Number(moneyText(line.employee_amount)),
			employer: Number(moneyText(line.employer_amount)),
			base: Number(moneyText(line.base_amount))
		};
	}
	return {
		period,
		status: isString(slip.status) ? slip.status : '',
		gross: Number(moneyText(slip.gross)),
		net: Number(moneyText(slip.net)),
		total_deductions: Number(moneyText(slip.total_deductions)),
		lines,
		statutory,
		// The leave rows the slip settled (VN-OBLIGATION-52: a return of leave taken).
		leave: (slip.leave_catalog_entry ?? []).map((row): JsonObject => ({
			code: codeOf(row),
			days: Number(moneyText(row.days)),
			from: isString(row.from) ? row.from : null,
			to: isString(row.to) ? row.to : null,
			facts: plainRow(row.facts)
		}))
	};
}
