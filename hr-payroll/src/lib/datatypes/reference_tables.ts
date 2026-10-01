import { Schema } from 'effect';
import { factKeysValueSchema, type FactKey } from './fact_keys.js';

/**
 * A settings version's table declarations: each names a table of its `reference_rows`, the columns
 * that key a lookup, the typed value columns every row carries and, for a band table, how a row's
 * `range_from`/`range_to` bound the looked-up value. The rows are the version's data; `table()`,
 * `band()` and `bands()` read them (`expressions/functions/tables.ts`).
 */

/** A row's own columns; a key may name one, any other key names a declared value column. */
export const ROW_COLUMNS = ['code', 'parent_code', 'label'] as const;
const RESERVED = new Set<string>([...ROW_COLUMNS, 'range_from', 'range_to']);

const identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/));

const declarationShape = Schema.Struct({
	name: identifier,
	label: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** The columns a lookup passes, in order: `table(name, key...)`. Empty is a single-row table. */
	keys: Schema.Array(identifier),
	/** Present on a band table: whether each bound admits the value equal to it. */
	range: Schema.optionalKey(
		Schema.NullOr(Schema.Struct({ from_inclusive: Schema.Boolean, to_inclusive: Schema.Boolean }))
	),
	columns: factKeysValueSchema
});

export type ReferenceTable = Omit<Schema.Schema.Type<typeof declarationShape>, 'columns'> & {
	readonly columns: readonly FactKey[];
};

const declarationSchema = declarationShape.check(
	Schema.makeFilter((table) => {
		const columns = new Set(table.columns.map((column) => column.key));
		for (const column of columns)
			if (RESERVED.has(column)) return `${table.name}: ${column} is a row column, not a value.`;
		if (new Set(table.keys).size !== table.keys.length)
			return `${table.name}: each key is named once.`;
		for (const key of table.keys)
			if (!(ROW_COLUMNS as readonly string[]).includes(key) && !columns.has(key))
				return `${table.name}: key ${key} is neither a row column nor a declared value column.`;
		return true;
	})
);

export const referenceTablesSchema = Schema.Array(declarationSchema).check(
	Schema.makeFilter(
		(tables) =>
			new Set(tables.map((table) => table.name)).size === tables.length ||
			'Each table is declared once.'
	)
);

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = Schema.toStandardSchemaV1(referenceTablesSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
