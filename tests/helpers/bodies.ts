// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Runs a 0.0.1 collection body (transform, query, action) the way the engine calls it, over in-memory tables.
 *
 * `tables` maps a collection to its rows; a read filters them with the scalar operators the bodies use (`eq ne in nin
 * isNull gt gte lt lte`, `and or not`) and `some`/`none` over a relation the fixture row carries as an array. A refusal
 * throws an `Error` whose `kind` is `'refused'`, as the guest reports it. `act` records every call and answers committed.
 */

const OPS = {
	eq: (v, x) => v === x,
	ne: (v, x) => v !== x,
	in: (v, x) => x.includes(v),
	nin: (v, x) => !x.includes(v),
	isNull: (v, x) => (v == null) === x,
	gt: (v, x) => v != null && v > x,
	gte: (v, x) => v != null && v >= x,
	lt: (v, x) => v != null && v < x,
	lte: (v, x) => v != null && v <= x
};

export function matches(row, where = {}) {
	return Object.entries(where).every(([key, test]) => {
		if (key === 'and') return test.every((w) => matches(row, w));
		if (key === 'or') return test.some((w) => matches(row, w));
		if (key === 'not') return !matches(row, test);
		const value = row[key];
		return Object.entries(test).every(([op, operand]) => {
			if (op === 'some') return (value ?? []).some((child) => matches(child, operand));
			if (op === 'none') return !(value ?? []).some((child) => matches(child, operand));
			if (op === 'is') return value != null && matches(value, operand);
			if (!(op in OPS)) throw new Error(`bodies helper: unsupported operator ${op}`);
			return OPS[op](value, operand);
		});
	});
}

export class Refusal extends Error {
	kind = 'refused';
	constructor(message, field) {
		super(message);
		this.field = field;
	}
}
const refuse = (message, at) => {
	throw new Refusal(message, at?.field);
};

function reads(tables) {
	const rows = (collection, where) =>
		(tables[collection] ?? []).filter((row) => matches(row, where));
	return {
		read: async (collection, q = {}) => {
			const found = rows(collection, q.where);
			const from = Number(q.after ?? 0);
			const to = q.all || q.limit == null ? found.length : from + q.limit;
			return { rows: found.slice(from, to), next: to < found.length ? String(to) : null };
		},
		get: async (collection, id) => (tables[collection] ?? []).find((row) => row.id === id) ?? null,
		after: async (collection, where) => rows(collection, where)
	};
}

const clock = (now = '2026-06-15T02:00:00.000Z') => ({
	now,
	today: now.slice(0, 10),
	tz: 'Asia/Kuala_Lumpur',
	todayIn: () => now.slice(0, 10),
	actor: { kind: 'member', id: 'member-1' }
});

/** One transform batch: `inputs`, the stored row per input (`undefined` for a create), and the tables it reads. */
export const transform = (collection, inputs, { existing, tables = {}, now } = {}) =>
	collection.bodies.transform(inputs, {
		...clock(now),
		existing: existing ?? inputs.map(() => undefined),
		db: reads(tables),
		refuse
	});

/** A caller context for a query or action: reads over `tables`, `act` recorded into `acts`. */
export function caller({ tables = {}, now, similar, target } = {}) {
	const acts = [];
	const ctx = {
		...clock(now),
		...reads(tables),
		invocationId: 'test',
		refuse,
		target,
		similar,
		acts,
		act: async (callable, input) => {
			acts.push({ callable, input });
			const collection = callable.split('.')[0];
			return {
				kind: 'committed',
				output: undefined,
				records: [{ collection, id: `${collection}-new`, revision: 1 }]
			};
		}
	};
	return ctx;
}

export const query = (collection, name, input, ctx) => collection.bodies.queries[name](input, ctx);
export const action = (collection, name, input, ctx) => collection.bodies.actions[name](input, ctx);
