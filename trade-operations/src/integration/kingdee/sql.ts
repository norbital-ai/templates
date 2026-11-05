import { Effect } from 'effect';
import type { DatabaseContext } from './polling.js';

type Scalar = string | number | boolean | null;
type Table = { readonly schema: string; readonly name: string };
type Column = { readonly tableAlias?: string; readonly name: string };
type Field =
	| { readonly value: Scalar }
	| { readonly column: Column; readonly aggregate?: 'sum' | 'min' | 'max' | 'count' };
/** Template-authored bindings only: connection configuration never supplies SQL or identifiers. */
export type SourceProjection = {
	readonly table: Table;
	readonly alias?: string;
	readonly key: string;
	readonly columns: readonly string[];
	readonly fields?: Readonly<Record<string, Field>>;
	readonly joins?: readonly {
		readonly kind: 'left' | 'inner';
		readonly table: Table;
		readonly alias: string;
		readonly on: readonly { readonly left: Column; readonly right: Column }[];
		readonly where?: Readonly<Record<string, Scalar>>;
	}[];
	readonly filters?: readonly (
		| { readonly field: Column; readonly op: 'in'; readonly value: readonly Scalar[] }
		| {
				readonly field: Column;
				readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
				readonly value: Scalar;
		  }
	)[];
	readonly groupBy?: readonly Column[];
	readonly keyParts?: readonly string[];
	readonly rowversion?: string;
	readonly rowversions?: readonly Column[];
	readonly where?: Readonly<Record<string, Scalar>>;
	readonly texts?: readonly string[];
	readonly decimals?: readonly string[];
	readonly dates?: readonly string[];
};
type Window = { readonly from: string; readonly to: string };
const q = (name: string) => `[${name.replaceAll(']', ']]')}]`;
const table = (source: Table) => `${q(source.schema)}.${q(source.name)}`;
const binaryOrder = 'Latin1_General_BIN2';
const relations = (source: SourceProjection) => [
	{ alias: source.alias ?? 'source', table: source.table },
	...(source.joins ?? []).map((join) => ({ alias: join.alias, table: join.table }))
];
export const sourceMarkers = (source: SourceProjection): Column[] => {
	const base = source.alias ?? 'source';
	const found = new Map<string, Column>();
	for (const marker of [
		...(source.rowversion === undefined ? [] : [{ tableAlias: base, name: source.rowversion }]),
		...(source.rowversions ?? [])
	]) {
		const column = { tableAlias: marker.tableAlias ?? base, name: marker.name };
		found.set(JSON.stringify(column), column);
	}
	return [...found.values()];
};

const parameters = () => {
	const values: Record<string, Scalar> = {};
	return {
		values,
		bind(value: Scalar, name = `p${Object.keys(values).length}`) {
			values[name] = value;
			return `@${name}`;
		}
	};
};
const execute = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	statement: string,
	values: Readonly<Record<string, Scalar>> = {}
) {
	const type = (value: Scalar) =>
		typeof value === 'boolean'
			? 'bit'
			: typeof value === 'number'
				? Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
					? 'int'
					: 'float'
				: 'nvarchar(max)';
	return (yield* ctx.request({
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		maxRows: 1000,
		arguments: {
			stmt: statement,
			params: Object.entries(values)
				.map(([name, value]) => `@${name} ${type(value)}`)
				.join(','),
			...values
		}
	})).rows;
});
export const sourceIdentity = (ctx: DatabaseContext) =>
	execute(
		ctx,
		'SELECT database_guid,recovery_fork_guid FROM sys.database_recovery_status WHERE database_id=DB_ID()'
	);
export const sourceClock = (ctx: DatabaseContext) =>
	execute(
		ctx,
		"SELECT CONVERT(varchar(18),MIN_ACTIVE_ROWVERSION(),1) AS maximum,CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at"
	);
export const sourceMetadata = (ctx: DatabaseContext, source: SourceProjection) => {
	const p = parameters(),
		markers = sourceMarkers(source);
	const selects = relations(source).flatMap((relation) => {
		const columns = markers.filter((column) => column.tableAlias === relation.alias);
		return (columns.length === 0 ? [null] : columns).map((column) => {
			const alias = p.bind(relation.alias),
				marker = p.bind(column?.name ?? null);
			const schema = p.bind(relation.table.schema),
				name = p.bind(relation.table.name);
			return `SELECT ${alias} AS [alias],${marker} AS [column],obj.object_id,CONVERT(varchar(33),obj.create_date,121) AS created,col.system_type_id AS rowversion_type
FROM sys.objects obj LEFT JOIN sys.columns col ON col.object_id=obj.object_id AND col.name=${marker}
WHERE obj.schema_id=SCHEMA_ID(${schema}) AND obj.name=${name} AND obj.type IN ('U','V')`;
		});
	});
	return execute(ctx, `${selects.join('\nUNION ALL\n')} ORDER BY [alias],[column]`, p.values);
};

/** SQL Server 2019: bounded keyset paging and XML, without native CDC objects. */
const projection = (source: SourceProjection, bind: (value: Scalar) => string) => {
	const base = source.alias ?? 'source';
	const column = (ref: Column) => `${q(ref.tableAlias ?? base)}.${q(ref.name)}`;
	const equality = (values: Readonly<Record<string, Scalar>> = {}, alias = base) =>
		Object.entries(values).map(
			([name, value]) =>
				`${q(alias)}.${q(name)}${value === null ? ' IS NULL' : ` = ${bind(value)}`}`
		);
	const predicates = equality(source.where);
	for (const filter of source.filters ?? []) {
		const field = column(filter.field);
		if (filter.op === 'in') {
			const values = filter.value.filter((value) => value !== null);
			const options = [
				...(values.length === 0
					? []
					: [`${field} IN (${values.map((value) => bind(value)).join(', ')})`]),
				...(filter.value.includes(null) ? [`${field} IS NULL`] : [])
			];
			predicates.push(options.length === 0 ? '1=0' : `(${options.join(' OR ')})`);
		} else {
			const operator = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.op];
			if (filter.value === null && filter.op !== 'eq' && filter.op !== 'ne')
				throw new Error('Invalid NULL comparison');
			predicates.push(
				filter.value === null
					? `${field} IS${filter.op === 'ne' ? ' NOT' : ''} NULL`
					: `${field} ${operator} ${bind(filter.value)}`
			);
		}
	}
	const field = (name: string) => {
		const selected = source.fields?.[name];
		if (selected === undefined) return column({ name });
		if ('value' in selected) return bind(selected.value);
		const value = column(selected.column);
		switch (selected.aggregate) {
			case undefined:
				return value;
			case 'sum':
				return `SUM(${value})`;
			case 'min':
				return `MIN(${value})`;
			case 'max':
				return `MAX(${value})`;
			case 'count':
				return `COUNT(${value})`;
		}
	};
	const parts = source.keyParts ?? [source.key];
	const selected = [...new Set([...parts, ...source.columns])].map(
		(name) => `${field(name)} AS ${q(name)}`
	);
	// Native timestamp ignores hexadecimal conversion styles until explicitly cast to binary.
	const versions = sourceMarkers(source).map(
		(ref) => `CONVERT(binary(8),ISNULL(${column(ref)},CONVERT(binary(8),'0x0000000000000000',1)))`
	);
	if (versions.length > 0) {
		const greatest =
			versions.length === 1
				? versions[0]
				: `CASE ${versions
						.slice(0, -1)
						.map(
							(value, index) =>
								`WHEN ${versions
									.slice(index + 1)
									.map((other) => `${value} >= ${other}`)
									.join(' AND ')} THEN ${value}`
						)
						.join(' ')} ELSE ${versions.at(-1)} END`;
		selected.push(
			`${source.groupBy === undefined ? greatest : `CONVERT(binary(8),MAX(CONVERT(varchar(16),CONVERT(binary(8),${greatest}),2) COLLATE ${binaryOrder}),2)`} AS __rowversion`
		);
	}
	const joins = (source.joins ?? []).map(
		(join) =>
			`${join.kind === 'left' ? 'LEFT' : 'INNER'} JOIN ${table(join.table)} AS ${q(join.alias)} ON ${[
				...join.on.map((pair) => `${column(pair.left)} = ${column(pair.right)}`),
				...equality(join.where, join.alias)
			].join(' AND ')}`
	);
	const sql = `SELECT ${selected.join(', ')} FROM ${table(source.table)} AS ${q(base)} ${joins.join(' ')}${predicates.length === 0 ? '' : ` WHERE ${predicates.join(' AND ')}`}${source.groupBy === undefined ? '' : ` GROUP BY ${source.groupBy.map(column).join(', ')}`}`;
	const key =
		source.keyParts === undefined
			? `CONVERT(nvarchar(max),${q(source.key)})`
			: parts
					.map(
						(name) =>
							`CASE WHEN ${q(name)} IS NULL THEN 'N' ELSE 'V'+CONVERT(varchar(max),CONVERT(varbinary(max),CONVERT(nvarchar(max),${q(name)})),2) END`
					)
					.join("+':'+");
	return { sql, key, versioned: versions.length > 0 };
};
export const sourcePage = (
	ctx: DatabaseContext,
	source: SourceProjection,
	after: string,
	window?: Window
) => {
	const p = parameters(),
		selected = projection(source, p.bind);
	const conditions = [
		`${selected.key} COLLATE ${binaryOrder} > ${p.bind(after, 'after')} COLLATE ${binaryOrder}`
	];
	if (window !== undefined) {
		if (
			!selected.versioned ||
			!/^0x[0-9a-f]{16}$/i.test(window.from) ||
			!/^0x[0-9a-f]{16}$/i.test(window.to) ||
			window.from.toLowerCase() > window.to.toLowerCase()
		)
			throw new Error('Invalid rowversion window');
		conditions.push(
			`__rowversion >= CONVERT(binary(8),${p.bind(window.from, 'from')},1)`,
			`__rowversion < CONVERT(binary(8),${p.bind(window.to, 'to')},1)`
		);
	}
	const columns = source.columns.map((name) =>
		source.decimals?.includes(name)
			? `CONVERT(varchar(100),${q(name)}) AS ${q(name)}`
			: source.dates?.includes(name)
				? `CONVERT(varchar(10),${q(name)},23) AS ${q(name)}`
				: source.texts?.includes(name)
					? `CONVERT(nvarchar(max),${q(name)}) AS ${q(name)}`
					: q(name)
	);
	return execute(
		ctx,
		`SELECT TOP 1000 ${selected.key} AS __key${selected.versioned ? ',CONVERT(varchar(18),CONVERT(binary(8),__rowversion),1) AS __rowversion' : ''},${columns.join(', ')} FROM (${selected.sql}) AS projected WHERE ${conditions.join(' AND ')} ORDER BY ${selected.key} COLLATE ${binaryOrder}`,
		p.values
	);
};
/** Recheck only local identities before marking them absent; paging absence alone is insufficient. */
export const sourceKeys = (
	ctx: DatabaseContext,
	source: SourceProjection,
	keys: readonly string[]
) => {
	if (keys.length > 999 || keys.some((key) => !/^[\x21-\x7e]{1,4096}$/.test(key)))
		throw new Error('Invalid source key batch');
	const p = parameters(),
		selected = projection(source, p.bind);
	const escape = (key: string) =>
		key.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
	const xml = p.bind(
		`<keys>${keys.map((key) => `<key>${escape(key)}</key>`).join('')}</keys>`,
		'keys'
	);
	return execute(
		ctx,
		`DECLARE @source_keys xml; SET @source_keys=CONVERT(xml,${xml});
SELECT DISTINCT TOP 1000 ${selected.key} COLLATE ${binaryOrder} AS __key FROM (${selected.sql}) AS projected
WHERE ${selected.key} COLLATE ${binaryOrder} IN (SELECT item.value('.', 'varchar(4096)') COLLATE ${binaryOrder} FROM @source_keys.nodes('/keys/key') AS wanted(item)) ORDER BY __key`,
		p.values
	);
};
