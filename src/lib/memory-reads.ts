import { Effect } from 'effect';

/**
 * Reads answered from rows already in hand.
 *
 * A transform gets two read waves. The payroll engine asks its questions in a dozen dependent
 * steps, each shaped by the answers before it, so the run reads everything it could need in two
 * concurrent waves (`payroll_runs/lib/preload.ts`) and the engine then asks the same questions of
 * this in-memory surface. The predicates match the engine's own where shapes — `eq`, `ne`, `in`,
 * `isNull`, `isNotNull` and the inequalities — and a `columns` projection returns the whole row,
 * which every reader tolerates.
 */
export type MemoryRow = Record<string, unknown>;
export type MemoryWorld = Readonly<Record<string, ReadonlyArray<MemoryRow>>>;

type MemoryQuery = { readonly where?: unknown; readonly limit?: number | undefined };

const OPERATORS = ['eq', 'ne', 'in', 'isNull', 'isNotNull', 'lt', 'lte', 'gt', 'gte'] as const;

const valuesEqual = (left: unknown, right: unknown): boolean =>
	left === right || (left == null && right == null);

const asOrderable = (value: unknown): string | number | null =>
	typeof value === 'number' || typeof value === 'string'
		? value
		: value == null
			? null
			: String(value);

const compare = (left: unknown, right: unknown): number => {
	const a = asOrderable(left);
	const b = asOrderable(right);
	if (a == null || b == null) return 0;
	return a < b ? -1 : a > b ? 1 : 0;
};

const matchPredicate = (value: unknown, predicate: unknown): boolean => {
	if (predicate == null || typeof predicate !== 'object' || Array.isArray(predicate))
		return valuesEqual(value, predicate);
	const clause = predicate as Record<string, unknown>;
	let sawOperator = false;
	for (const operator of OPERATORS) {
		if (!(operator in clause)) continue;
		sawOperator = true;
		const operand = clause[operator];
		switch (operator) {
			case 'eq':
				if (!valuesEqual(value, operand)) return false;
				break;
			case 'ne':
				if (valuesEqual(value, operand)) return false;
				break;
			case 'in':
				if (!Array.isArray(operand) || !operand.some((candidate) => valuesEqual(value, candidate)))
					return false;
				break;
			case 'isNull':
				if (Boolean(operand) !== (value == null)) return false;
				break;
			case 'isNotNull':
				if (Boolean(operand) !== (value != null)) return false;
				break;
			case 'lt':
				if (compare(value, operand) >= 0) return false;
				break;
			case 'lte':
				if (compare(value, operand) > 0) return false;
				break;
			case 'gt':
				if (compare(value, operand) <= 0) return false;
				break;
			case 'gte':
				if (compare(value, operand) < 0) return false;
				break;
			default: {
				const _exhaustive: never = operator;
				return _exhaustive;
			}
		}
	}
	if (sawOperator) return true;
	if (value != null && typeof value === 'object' && !Array.isArray(value))
		return matchWhere(value as MemoryRow, predicate);
	return false;
};

export const matchWhere = (row: MemoryRow, where: unknown): boolean => {
	if (where == null || typeof where !== 'object') return true;
	for (const [key, predicate] of Object.entries(where as Record<string, unknown>))
		if (!matchPredicate(row[key], predicate)) return false;
	return true;
};

const select = (rows: ReadonlyArray<MemoryRow>, query: MemoryQuery): MemoryRow[] => {
	const matched = rows.filter((row) => matchWhere(row, query.where));
	return query.limit == null ? matched : matched.slice(0, query.limit);
};

/** One collection's reads over the rows given. */
const memoryCollection = (rows: ReadonlyArray<MemoryRow>) => ({
	findMany: (query: MemoryQuery) => Effect.succeed(select(rows, query)),
	findFirst: (query: MemoryQuery) => Effect.succeed(select(rows, query)[0]),
	count: (query: MemoryQuery) => Effect.succeed(select(rows, query).length)
});

/** `{ db }` over a world: every collection the world names, answered from memory. */
export const memoryReads = (world: MemoryWorld) => ({
	db: Object.fromEntries(
		Object.entries(world).map(([name, rows]) => [name, memoryCollection(rows)])
	)
});
