import { Effect } from 'effect';
import { isCalendarDate } from '@norbital-ai/std/date';
import { dateKey } from './iso-day.js';

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

/**
 * A day column is compared as a day when either side names one bare. A stored row carries the
 * day's UTC midnight and the engine's bounds are the same instants, so text order is exact for
 * them; a fixture row holding `2026-01-19` beside a bound of `2026-01-19T00:00:00.000Z` would sort
 * before it as text, so both are read to their calendar day first, as `dateKey` reads any row.
 */
const dayOf = (value: unknown): string | null =>
	typeof value === 'string' && isCalendarDate(value) ? value : null;
const asDays = (left: unknown, right: unknown): readonly [string, string] | null => {
	if (dayOf(left) == null && dayOf(right) == null) return null;
	if (typeof left !== 'string' || typeof right !== 'string') return null;
	const a = dateKey(left);
	const b = dateKey(right);
	return a === '' || b === '' ? null : [a, b];
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
	const days = asDays(left, right);
	if (days != null) return days[0] === days[1];
	return left === right || (left == null && right == null);
};

const asOrderable = (value: unknown): string | number | null =>
	typeof value === 'number' || typeof value === 'string'
		? value
		: value == null
			? null
			: String(value);

const compare = (left: unknown, right: unknown): number => {
	const days = asDays(left, right);
	const a = days == null ? asOrderable(left) : days[0];
	const b = days == null ? asOrderable(right) : days[1];
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
