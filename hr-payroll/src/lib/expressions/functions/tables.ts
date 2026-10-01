/**
 * Dated tables: `table()`, `band()` and `bands()` over a settings version's `reference_rows`.
 *
 * A statutory table is data — a floor per region, a rate per band — stored as rows under the
 * version and declared by its `tables`. The engine only looks rows up: the ones in force on the
 * site's resolution date (the caller binds it), matched by the declared keys and, for a band
 * table, by the range that contains the value. A row reads as a map: its declared value columns
 * beside `code`, `label`, `parent_code`, `range_from` and `range_to`.
 */

import { coversDate } from '../../payroll/run/effective.js';
import { periodsOverlap, governed } from '../../jurisdiction_settings.js';
import { factValueFault, type CodeResolver, type FactKey } from '../../datatypes/fact_keys.js';
import type { ReferenceTable } from '../../datatypes/reference_tables.js';
import type { ExpressionFunctionEntry } from './index.js';
import { decodeNumber } from '../../wire.js';

type Scalar = string | number | boolean;

/** One stored row, as `reference_rows` holds it. */
export type ReferenceRow = {
	readonly table: string;
	readonly code: string;
	readonly parent_code?: string | null | undefined;
	readonly label?: string | null | undefined;
	readonly effective_range: unknown;
	readonly range_from?: number | null | undefined;
	readonly range_to?: number | null | undefined;
	readonly values?: Readonly<Record<string, Scalar>> | null | undefined;
};

/** A stored row as a read returns it (its bounds a `Decimal`), with the bounds as numbers. */
export const referenceRowOf = <
	R extends { readonly range_from?: unknown; readonly range_to?: unknown }
>(
	row: R
): R & Pick<ReferenceRow, 'range_from' | 'range_to'> => ({
	...row,
	range_from: row.range_from == null ? null : decodeNumber(row.range_from),
	range_to: row.range_to == null ? null : decodeNumber(row.range_to)
});

/**
 * A context's own tables: a site context built on a date carries its version's lookup on that date
 * under this key, invisible to CEL, and an evaluation whose engine binds none reads it.
 */
export const TABLES: unique symbol = Symbol('reference tables');

/** The lookup `context` (or the person it carries) was built with, if any. */
export const tablesIn = (context: unknown): TableLookup | undefined => {
	const own = (value: unknown) =>
		(value as { readonly [TABLES]?: TableLookup } | null | undefined)?.[TABLES];
	return own(context) ?? own((context as { readonly person?: unknown } | null)?.person);
};

/** A looked-up row as an expression reads it. */
export type TableRowMap = Readonly<Record<string, Scalar | null>>;

/** What a bound evaluation looks up; `ExpressionEngine.tables` carries one per resolution date. */
export type TableLookup = {
	readonly table: (name: string, keys: readonly unknown[]) => TableRowMap | null;
	readonly band: (name: string, value: number, keys: readonly unknown[]) => TableRowMap | null;
	readonly bands: (name: string, keys: readonly unknown[]) => readonly TableRowMap[];
};

/** A key or row column's value: `code`, `parent_code` and `label` are the row's own, the rest its values. */
const cell = (row: ReferenceRow, column: string): Scalar | null =>
	column === 'code'
		? row.code
		: column === 'parent_code' || column === 'label'
			? (row[column] ?? null)
			: (row.values?.[column] ?? null);

// cel-js hands an int literal over as a bigint; the text of both is the same key.
const sameKey = (left: unknown, right: unknown): boolean =>
	left != null && right != null && String(left) === String(right);

const mapOf = (row: ReferenceRow): TableRowMap => ({
	...(row.values ?? {}),
	code: row.code,
	label: row.label ?? null,
	parent_code: row.parent_code ?? null,
	range_from: row.range_from ?? null,
	range_to: row.range_to ?? null
});

/** Whether a row's range admits `value`, per its table's declared bound inclusivity. */
function contains(
	range: NonNullable<ReferenceTable['range']>,
	row: Pick<ReferenceRow, 'range_from' | 'range_to'>,
	value: number
): boolean {
	const { range_from: from, range_to: to } = row;
	return (
		(from == null || value > from || (range.from_inclusive && value === from)) &&
		(to == null || value < to || (range.to_inclusive && value === to))
	);
}

/** Two rows' ranges share a value. */
function rangesOverlap(
	range: NonNullable<ReferenceTable['range']>,
	left: Pick<ReferenceRow, 'range_from' | 'range_to'>,
	right: Pick<ReferenceRow, 'range_from' | 'range_to'>
): boolean {
	const touchesInside = range.from_inclusive && range.to_inclusive;
	const endsBefore = (
		a: Pick<ReferenceRow, 'range_from' | 'range_to'>,
		b: Pick<ReferenceRow, 'range_from' | 'range_to'>
	) =>
		a.range_to != null &&
		b.range_from != null &&
		(a.range_to < b.range_from || (a.range_to === b.range_from && !touchesInside));
	return !endsBefore(left, right) && !endsBefore(right, left);
}

function declared(
	declarations: readonly ReferenceTable[],
	name: string,
	fn: 'table' | 'band' | 'bands',
	keys: readonly unknown[]
): ReferenceTable {
	const table = declarations.find((declaration) => declaration.name === name);
	if (table == null) throw new Error(`${fn}(): this settings version declares no table ${name}.`);
	if (fn === 'table' && table.range != null)
		throw new Error(`table(): ${name} is a band table; look it up with band().`);
	if (fn === 'band' && table.range == null)
		throw new Error(`band(): ${name} declares no range; look it up with table().`);
	if (keys.length !== table.keys.length)
		throw new Error(
			`${fn}(): ${name} is keyed by ${table.keys.length === 0 ? 'nothing' : table.keys.join(', ')}; ` +
				`this call passes ${keys.length} key${keys.length === 1 ? '' : 's'}.`
		);
	return table;
}

/**
 * The lookups over one version's rows, for any resolution date: index once, then bind a date per
 * site (`at(day)`). A table the version does not declare, a band lookup on a keyed table and a
 * wrong key count throw, which the run reports as the expression's fault.
 */
export function referenceTables(
	declarations: readonly ReferenceTable[],
	rows: readonly ReferenceRow[]
): (asOf: string) => TableLookup {
	const byTable = Map.groupBy(rows, (row) => row.table);
	return (asOf) => {
		const matching = (table: ReferenceTable, keys: readonly unknown[]) =>
			(byTable.get(table.name) ?? []).filter(
				(row) =>
					coversDate(row.effective_range, asOf) &&
					table.keys.every((key, index) => sameKey(cell(row, key), keys[index]))
			);
		return {
			table: (name, keys) => {
				const row = matching(declared(declarations, name, 'table', keys), keys)[0];
				return row == null ? null : mapOf(row);
			},
			band: (name, value, keys) => {
				const table = declared(declarations, name, 'band', keys);
				const row = matching(table, keys).find((candidate) =>
					contains(table.range!, candidate, value)
				);
				return row == null ? null : mapOf(row);
			},
			bands: (name, keys) =>
				matching(declared(declarations, name, 'bands', keys), keys)
					.toSorted(
						(a, b) =>
							(a.range_from ?? -Infinity) - (b.range_from ?? -Infinity) ||
							a.code.localeCompare(b.code)
					)
					.map(mapOf)
		};
	};
}

const emptyOf = (column: FactKey): Scalar =>
	column.type === 'number' ? 0 : column.type === 'boolean' ? false : '';

/**
 * The write-time stand-in: every declared table answers one placeholder row (each column its
 * type's empty value), so an expression is checked against the declared names, keys and columns
 * without the rows. An undeclared table or a wrong key count throws, as it would at the run.
 */
export function declaredTables(declarations: readonly ReferenceTable[]): TableLookup {
	const placeholder = (table: ReferenceTable): TableRowMap => ({
		...Object.fromEntries(table.columns.map((column) => [column.key, emptyOf(column)])),
		code: '',
		label: '',
		parent_code: '',
		range_from: 0,
		range_to: 0
	});
	return {
		table: (name, keys) => placeholder(declared(declarations, name, 'table', keys)),
		band: (name, _value, keys) => placeholder(declared(declarations, name, 'band', keys)),
		bands: (name, keys) => [placeholder(declared(declarations, name, 'bands', keys))]
	};
}

/** A `code` fact's resolver over one version's rows on one date (`factValuesFault`'s `codes`). */
export function referenceCodes(rows: readonly ReferenceRow[], asOf: string): CodeResolver {
	return (table, code) => {
		const row = rows.find(
			(candidate) =>
				candidate.table === table &&
				candidate.code === code &&
				coversDate(candidate.effective_range, asOf)
		);
		return row == null ? null : { parent_code: row.parent_code ?? null };
	};
}

// ponytail: a text scan, not the AST — a string literal spelling `table('X'` inside another string
// reads as a mention; walk `programFor(expression).ast` if that ever bites.
const MENTION = /\b(table|bands?)\s*\(\s*(?:'([^']*)'|"([^"]*)")/g;

/** Every table an expression names by a literal, with the function it calls. */
export function tableMentions(
	expression: string
): readonly { readonly fn: 'table' | 'band' | 'bands'; readonly name: string }[] {
	return [...expression.matchAll(MENTION)].map((match) => ({
		fn: match[1] as 'table' | 'band' | 'bands',
		name: match[2] ?? match[3] ?? ''
	}));
}

/** Whether an expression calls a table function at all (a compile without declarations parses it only). */
export const callsTables = (expression: string): boolean =>
	/\b(?:table|bands?)\s*\(/.test(expression);

/** The first mention of a table the version does not declare, or of the wrong lookup for its shape. */
export function tableMentionFault(
	declarations: readonly ReferenceTable[],
	expression: string
): string | null {
	for (const { fn, name } of tableMentions(expression)) {
		const table = declarations.find((declaration) => declaration.name === name);
		if (table == null)
			return `${fn}('${name}') names a table this settings version does not declare.`;
		if (fn === 'table' && table.range != null)
			return `table('${name}') reads a band table; use band('${name}', value, …).`;
		if (fn === 'band' && table.range == null)
			return `band('${name}', …) reads a table without a range; use table('${name}', …).`;
	}
	return null;
}

/**
 * The first fault of a version's rows against its declarations: a row of an undeclared table, a
 * key column it leaves empty, a value that is not its column's type (a `code` column checked
 * against the version's own rows on the row's first day), a range on a keyed table, a range that
 * runs backwards, and two rows of one key whose dates and ranges overlap. Ceilings and floors are
 * compared exactly, so a both-inclusive seam steps by the smallest unit (one cent).
 */
export function referenceRowsFault(
	declarations: readonly ReferenceTable[],
	rows: readonly ReferenceRow[]
): string | null {
	for (const row of rows) {
		const where = `Reference row ${row.table}/${row.code}`;
		const table = declarations.find((declaration) => declaration.name === row.table);
		if (table == null) return `${where} belongs to a table this settings version does not declare.`;
		const days = governed(row.effective_range);
		if (days == null) return `${where} states the dates it is in force.`;
		for (const key of table.keys)
			if (cell(row, key) == null || cell(row, key) === '')
				return `${where} has no ${key}, a key of its table.`;
		const codes = referenceCodes(rows, days.from);
		for (const column of table.columns) {
			const value = row.values?.[column.key];
			const fault =
				value === undefined
					? column.required
						? `${column.label?.trim() || column.key} is required.`
						: null
					: factValueFault(column, value, codes);
			if (fault != null) return `${where}: ${fault}`;
		}
		for (const key of Object.keys(row.values ?? {}))
			if (!table.columns.some((column) => column.key === key))
				return `${where} carries ${key}, which its table does not declare.`;
		const ranged = row.range_from != null || row.range_to != null;
		if (table.range == null && ranged) return `${where} has a range, but its table declares none.`;
		if (row.range_from != null && row.range_to != null && row.range_to < row.range_from)
			return `${where} ends its range below its start.`;
	}
	for (const table of declarations) {
		const own = rows.filter((row) => row.table === table.name);
		for (const [index, left] of own.entries())
			for (const right of own.slice(index + 1)) {
				const sameKeys = table.keys.every((key) => sameKey(cell(left, key), cell(right, key)));
				const leftDays = governed(left.effective_range);
				const rightDays = governed(right.effective_range);
				if (!sameKeys || leftDays == null || rightDays == null) continue;
				if (!periodsOverlap(leftDays, rightDays)) continue;
				if (table.range != null && !rangesOverlap(table.range, left, right)) continue;
				return (
					`Reference rows ${table.name}/${left.code} and ${table.name}/${right.code} overlap: ` +
					`the same ${table.keys.join(', ') || 'table'}${table.range == null ? '' : ' and range'} ` +
					'on the same days. End one the day before the other begins.'
				);
			}
	}
	return null;
}

const dyns = (count: number) => Array.from({ length: count }, () => ', dyn').join('');

/** The engine's reader, refused where the caller bound none: a table lookup without rows is a bug, not a zero. */
const lookupOf = (
	engine: { readonly tables?: TableLookup | undefined },
	fn: string
): TableLookup => {
	if (engine.tables == null) throw new Error(`${fn}(): no reference tables are bound here.`);
	return engine.tables;
};

/** Up to three keys each: CEL has no variadic overload. */
const TABLE_KEY_ARITY = [0, 1, 2, 3];
export const TABLE_FUNCTIONS: readonly ExpressionFunctionEntry[] = TABLE_KEY_ARITY.flatMap(
	(keys, index): ExpressionFunctionEntry[] => [
		{
			signature: `table(string${dyns(keys)}): dyn`,
			handler: (engine, name, ...args) => lookupOf(engine, 'table').table(String(name), args),
			...(index === 0
				? {
						doc: {
							path: "table('NAME', key…)",
							description:
								'The row of a declared table whose keys match, in force on the site’s date, as a map of its columns; null where none'
						}
					}
				: {})
		},
		{
			signature: `band(string, dyn${dyns(keys)}): dyn`,
			handler: (engine, name, value, ...args) =>
				lookupOf(engine, 'band').band(String(name), Number(value), args),
			...(index === 0
				? {
						doc: {
							path: "band('NAME', value, key…)",
							description:
								'The row of a declared band table whose range contains value, in force on the site’s date; null where none'
						}
					}
				: {})
		},
		{
			signature: `bands(string${dyns(keys)}): list`,
			handler: (engine, name, ...args) => lookupOf(engine, 'bands').bands(String(name), args),
			...(index === 0
				? {
						doc: {
							path: "bands('NAME', key…)",
							description:
								'Every row of a declared table whose keys match, in force on the site’s date, lowest range first'
						}
					}
				: {})
		}
	]
);
