/**
 * Declared returns and bank files (`jurisdiction_settings.returns`): what a settings version hands an
 * authority or a bank, generated from settled payslips. Every cell, the population, the file name and
 * the record layout are stored configuration; `run/returns.ts` only evaluates them over the `filing`
 * site and writes the bytes.
 *
 * A declaration naming `payer_bank` is a bank file: the export picks it for the entity whose
 * originator account's bank code matches, one row per payment. Any other is a return, one row per
 * person over the payslips of its cadence (a run, a month, a quarter or a year).
 */

import { compileExpression } from '../expressions/compile.js';

export const RETURN_CADENCES = ['EVENT', 'MONTH', 'QUARTER', 'YEAR'] as const;
export const RETURN_FORMATS = ['CSV', 'XLSX', 'FIXED'] as const;
export const RETURN_ENCODINGS = ['UTF-8', 'ASCII'] as const;
export const RETURN_ALIGNS = ['LEFT', 'RIGHT'] as const;
export const RETURN_LINE_ENDS = ['LF', 'CRLF'] as const;

/** One cell of a record: a text expression over the `filing` site, laid out as the format demands. */
export type ReturnColumn = {
	readonly key: string;
	/** The column heading a CSV or XLSX with `header` writes. */
	readonly label?: string | null;
	readonly value: string;
	/** FIXED: the field's width in characters. */
	readonly width?: number | null;
	/** FIXED: which side the value sits on; LEFT unless stated. */
	readonly align?: (typeof RETURN_ALIGNS)[number] | null;
	/** FIXED: the one character that fills the width; a space unless stated. */
	readonly pad?: string | null;
	/** The value must match this pattern, or the file is refused rather than rejected by its receiver. */
	readonly pattern?: string | null;
	/** FIXED: a value longer than its width is cut; without it the file is refused. */
	readonly truncate?: boolean | null;
};

export type ReturnRecord = { readonly columns: readonly ReturnColumn[] };

export type ReturnDeclaration = {
	readonly code: string;
	readonly label?: string | null;
	readonly authority?: string | null;
	/** EVENT: each run. MONTH, QUARTER, YEAR: the settled runs of that calendar span (`2026-03`, `2026-Q1`, `2026`). */
	readonly cadence: (typeof RETURN_CADENCES)[number];
	/** A bank file: the pattern the payer's bank code must match (case-insensitive). */
	readonly payer_bank?: string | null;
	/** Boolean over the `filing` site: which rows the file carries; every row where absent. */
	readonly population?: string | null;
	/** Identification types, each by the pattern its number matches; any other number is refused. */
	readonly identity_patterns?:
		readonly { readonly type: string; readonly pattern: string }[] | null;
	readonly columns: readonly ReturnColumn[];
	/** Records written before and after the rows, over the file-level context (`row.index` 0, every row summed). */
	readonly header_records?: readonly ReturnRecord[] | null;
	readonly trailer_records?: readonly ReturnRecord[] | null;
	readonly format: {
		readonly kind: (typeof RETURN_FORMATS)[number];
		/** CSV/XLSX: write the column labels as the first row. */
		readonly header?: boolean | null;
		readonly delimiter?: string | null;
		readonly encoding?: (typeof RETURN_ENCODINGS)[number] | null;
		/** CRLF for CSV and LF for FIXED unless stated. */
		readonly line_end?: (typeof RETURN_LINE_ENDS)[number] | null;
		/** End the last record with a line end too. */
		readonly final_line_end?: boolean | null;
		/** Text over the file-level context: the file's name, extension included. */
		readonly name?: string | null;
	};
	/** The obligation instance the generated file evidences: its duty code and the completion fact it fills. */
	readonly evidence?: { readonly duty: string; readonly fact_key: string } | null;
};

/** The declarations a stored version holds; `[]` where it declares none. */
export const returnsOf = (version: { readonly returns?: unknown } | null | undefined) =>
	(Array.isArray(version?.returns) ? version.returns : []) as readonly ReturnDeclaration[];

const validPattern = (pattern: string) => {
	try {
		new RegExp(pattern);
		return true;
	} catch {
		return false;
	}
};

const columnFault = (
	code: string,
	column: ReturnColumn,
	fixed: boolean,
	tables?: Parameters<typeof compileExpression>[0]['tables']
): string | null => {
	const at = `${code} ${column.key}`;
	if (column.value.trim() === '') return `${at}: a column states its value.`;
	const fault = compileExpression({
		expression: column.value,
		site: 'filing',
		type: 'text',
		tables
	});
	if (fault != null) return `${at}: ${fault}`;
	if (column.pattern != null && !validPattern(column.pattern))
		return `${at}: the pattern is not a valid regular expression.`;
	if (fixed && !(Number.isInteger(column.width) && column.width! > 0))
		return `${at}: a fixed-width field states its width.`;
	if (column.pad != null && column.pad.length !== 1) return `${at}: a pad is one character.`;
	return null;
};

/** The first fault of a version's declarations, or undefined. */
export function returnsFault(
	declarations: readonly ReturnDeclaration[],
	tables?: Parameters<typeof compileExpression>[0]['tables']
): string | undefined {
	const codes = declarations.map((row) => row.code);
	if (codes.some((code) => !/^[A-Z][A-Z0-9_]*$/.test(code)))
		return 'A return code is upper-case letters, digits and underscores.';
	if (new Set(codes).size !== codes.length) return 'Each return is declared once.';
	for (const row of declarations) {
		const fixed = row.format.kind === 'FIXED';
		if (row.columns.length === 0) return `${row.code}: a return declares its columns.`;
		const keys = row.columns.map((column) => column.key);
		if (new Set(keys).size !== keys.length) return `${row.code}: each column key is declared once.`;
		if (row.payer_bank != null && !validPattern(row.payer_bank))
			return `${row.code}: payer_bank is not a valid regular expression.`;
		if (row.payer_bank != null && row.cadence !== 'EVENT')
			return `${row.code}: a bank file pays one run; its cadence is EVENT.`;
		if (row.identity_patterns?.some((id) => id.type === '' || !validPattern(id.pattern)))
			return `${row.code}: each identity type has a name and a valid pattern.`;
		if (row.format.delimiter != null && row.format.delimiter.length !== 1)
			return `${row.code}: a delimiter is one character.`;
		const population = compileExpression({
			expression: row.population,
			site: 'filing',
			type: 'boolean',
			tables
		});
		if (population != null) return `${row.code} population: ${population}`;
		const name = compileExpression({
			expression: row.format.name,
			site: 'filing',
			type: 'text',
			tables
		});
		if (name != null) return `${row.code} name: ${name}`;
		for (const column of [
			...row.columns,
			...(row.header_records ?? []).flatMap((record) => record.columns),
			...(row.trailer_records ?? []).flatMap((record) => record.columns)
		]) {
			const fault = columnFault(row.code, column, fixed, tables);
			if (fault != null) return fault;
		}
		if (row.evidence != null && (row.evidence.duty === '' || row.evidence.fact_key === ''))
			return `${row.code}: evidence names its duty and completion fact.`;
	}
	return undefined;
}
