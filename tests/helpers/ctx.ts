// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import relationships from '../../src/data/+relationship.ts';

/**
 * A collection body's `ctx` over rows in memory: `db.read/get/after` as the workspace, `refuse` as the prelude's,
 * and the clock. The `Where` evaluator covers what the template's bodies use: column operators, `and/or/not`, a
 * one-relation `{ is }` through the FK and a many-relation `some/none/every` through its inverse (§3.3.9).
 */
const ONE = new Map(); // `${model}.${fk}` → target
const MANY = new Map(); // `${model}.${inverse}` → { child, fk }
for (const [key, spec] of Object.entries(relationships)) {
	const [model, fk] = key.split('.');
	ONE.set(`${model}.${fk}`, spec.to);
	if (spec.inverse) MANY.set(`${spec.to}.${spec.inverse}`, { child: model, fk });
}

const cmp = (a, b) =>
	typeof a === 'number' || typeof b === 'number'
		? Number(a) - Number(b)
		: String(a).localeCompare(String(b));

function matchOps(value, ops) {
	if (ops === null || typeof ops !== 'object' || Array.isArray(ops)) return value === ops;
	for (const [op, arg] of Object.entries(ops)) {
		const ok =
			op === 'eq'
				? value === arg || (value != null && arg != null && cmp(value, arg) === 0)
				: op === 'ne'
					? !(value === arg || (value != null && arg != null && cmp(value, arg) === 0))
					: op === 'in'
						? arg.some((x) => x === value)
						: op === 'nin'
							? !arg.some((x) => x === value)
							: op === 'isNull'
								? (value == null) === arg
								: op === 'lt'
									? value != null && cmp(value, arg) < 0
									: op === 'lte'
										? value != null && cmp(value, arg) <= 0
										: op === 'gt'
											? value != null && cmp(value, arg) > 0
											: op === 'gte'
												? value != null && cmp(value, arg) >= 0
												: op === 'like'
													? new RegExp(`^${String(arg).replaceAll('%', '.*')}$`, 'i').test(
															String(value ?? '')
														)
													: (() => {
															throw new Error(`memory ctx: unsupported operator ${op}`);
														})();
		if (!ok) return false;
	}
	return true;
}

export function matches(tables, model, row, where) {
	if (where == null) return true;
	return Object.entries(where).every(([key, clause]) => {
		if (key === 'and') return clause.every((w) => matches(tables, model, row, w));
		if (key === 'or') return clause.some((w) => matches(tables, model, row, w));
		if (key === 'not') return !matches(tables, model, row, clause);
		const many = MANY.get(`${model}.${key}`);
		if (many) {
			const children = (tables[many.child] ?? []).filter((child) => child[many.fk] === row.id);
			const hit = (w) => children.filter((child) => matches(tables, many.child, child, w));
			if ('some' in clause) return hit(clause.some).length > 0;
			if ('none' in clause) return hit(clause.none).length === 0;
			if ('every' in clause) return hit(clause.every).length === children.length;
			throw new Error(`memory ctx: unsupported relation clause on ${key}`);
		}
		const target = ONE.get(`${model}.${key}`);
		if (target && clause && typeof clause === 'object' && 'is' in clause) {
			const parent = (tables[target] ?? []).find((candidate) => candidate.id === row[key]);
			return parent != null && matches(tables, target, parent, clause.is);
		}
		// A reference field (`{ collection, id }`) is filtered by its target collection: `{ employment_terms: { in } }`.
		const value = row[key];
		if (value?.collection != null && 'id' in value && clause && typeof clause === 'object')
			return Object.entries(clause).every(
				([collection, ops]) => value.collection === collection && matchOps(value.id, ops)
			);
		return matchOps(value, clause);
	});
}

export function memoryDb(tables) {
	const rows = (collection, where) =>
		(tables[collection] ?? []).filter((row) => matches(tables, collection, row, where));
	return {
		// A page's `next` is the offset of the next page, as the engine's cursor continues a paged read.
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

/** The prelude's refusal: a `Refused`-shaped `Error`, so `assert.rejects(p, /message/)` reads it. */
const refuse = (message, at) => {
	throw Object.assign(new Error(message), {
		kind: 'refused',
		code: 'refused',
		message,
		...(at?.field ? { field: at.field } : {})
	});
};

export function memoryCtx(
	tables = {},
	{ existing = [], now = '2026-09-25T02:00:00.000Z', actor = { kind: 'system' } } = {}
) {
	return {
		actor,
		now,
		today: now.slice(0, 10),
		tz: 'Asia/Kuala_Lumpur',
		todayIn: () => now.slice(0, 10),
		existing,
		db: memoryDb(tables),
		refuse
	};
}

/** One write batch through a collection's transform, as the engine calls it. */
export function runTransform(
	collection,
	inputs,
	{ tables = {}, existing = inputs.map(() => undefined), now } = {}
) {
	return collection.bodies.transform(inputs, memoryCtx(tables, { existing, now }));
}

/** A delete batch through a collection's delete guard. */
export function runDelete(collection, stored, { tables = {} } = {}) {
	return collection.bodies.transform(
		stored.map(() => ({ $delete: true })),
		memoryCtx(tables, { existing: stored })
	);
}
