import {
	isJsonObject,
	stableJson,
	type Json,
	type JsonObject
} from './payroll_engine/foundation.js';

/** One dated fact as a profile lists it: from `from`, `name` is `value`. An empty value takes the fact away. */
export interface Fact {
	readonly name: string;
	readonly value: Json;
	readonly from: string;
}

/** How a dated model holds its facts: `fields` as its own fields, any other name as a key of its `record` field. */
export interface FactShape {
	readonly fields: readonly string[];
	readonly record?: string;
}

const held = (row: JsonObject, shape: FactShape): Record<string, Json> => {
	const record = shape.record === undefined ? undefined : row[shape.record];
	return {
		...Object.fromEntries(
			(Array.isArray(row.clears) ? row.clears : []).map((name): [string, Json] => [
				String(name),
				null
			])
		),
		...Object.fromEntries(
			shape.fields.flatMap((name): [string, Json][] => {
				const value = row[name];
				return value == null ? [] : [[name, value]];
			})
		),
		...Object.fromEntries(
			Object.entries(isJsonObject(record) ? record : {}).filter(([, value]) => value !== null)
		)
	};
};

/** The facts a family's stored rows hold: one per value a row sets or takes away, dated as its row, by name then date. */
export const factsOf = (rows: readonly JsonObject[], shape: FactShape): readonly Fact[] =>
	rows
		.flatMap((row) =>
			Object.entries(held(row, shape)).map(([name, value]) => ({
				name,
				value,
				from: String(row.effective_from)
			}))
		)
		.toSorted((a, b) => a.name.localeCompare(b.name) || a.from.localeCompare(b.from));

const target = (row: JsonObject) => ({ id: row.id ?? null, revision: row.revision ?? null });

/**
 * The writes that store a list of facts as typed: the facts of one date are one row. A date with no row gains one, a
 * row whose facts differ is rewritten, and a row left with no fact is deleted. A fact with no name or date is not
 * stored; of two with one name and date, the later in the list stands.
 */
export const factWrites = (
	rows: readonly JsonObject[],
	facts: readonly Fact[],
	owner: JsonObject,
	shape: FactShape
): {
	readonly create: readonly JsonObject[];
	readonly update: readonly JsonObject[];
	readonly delete: readonly JsonObject[];
	/** The dates of the rows written. */
	readonly dates: readonly string[];
} => {
	const wanted = new Map(
		[
			...Map.groupBy(
				facts.filter((fact) => fact.name !== '' && fact.from !== ''),
				(fact) => fact.from
			)
		].map(([from, list]) => [from, Object.fromEntries(list.map((fact) => [fact.name, fact.value]))])
	);
	const stored = new Map(rows.map((row) => [String(row.effective_from), row]));
	const body = (named: Record<string, Json>): Record<string, Json> => ({
		...Object.fromEntries(shape.fields.map((name) => [name, named[name] ?? null])),
		...(shape.record === undefined
			? {}
			: {
					[shape.record]: Object.fromEntries(
						Object.entries(named).filter(
							([name, value]) => value !== null && !shape.fields.includes(name)
						)
					)
				}),
		clears: Object.keys(named).filter((name) => named[name] === null)
	});
	const added = [...wanted].filter(([from]) => !stored.has(from));
	const changed = [...wanted].flatMap(([from, named]) => {
		const row = stored.get(from);
		return row === undefined || stableJson(held(row, shape)) === stableJson(named)
			? []
			: [{ from, row, named }];
	});
	const gone = [...stored].filter(([from]) => !wanted.has(from));
	return {
		create: added.map(([from, named]) => ({
			...owner,
			effective_from: from,
			...Object.fromEntries(
				Object.entries(body(named)).filter(
					([, value]) => value !== null && !(Array.isArray(value) && value.length === 0)
				)
			)
		})),
		update: changed.map(({ row, named }) => ({ target: target(row), set: body(named) })),
		delete: gone.map(([, row]) => ({ target: target(row) })),
		dates: [
			...added.map(([from]) => from),
			...changed.map(({ from }) => from),
			...gone.map(([from]) => from)
		]
	};
};
