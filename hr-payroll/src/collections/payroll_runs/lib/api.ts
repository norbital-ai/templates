/**
 * The database surface the engine runs against.
 *
 * The build happens in the payroll run's `after` hook, so it holds the post-write capabilities:
 * relational reads plus elevated `mutate`/`delete`. Deriving the type from the hook signature
 * rather than restating it keeps the engine honest — if the platform narrows what an `after` hook
 * may do, this stops compiling instead of failing at run time.
 */

import type { Hooks } from '../$types.js';

type CreateAfterHook = NonNullable<
	NonNullable<NonNullable<Hooks['create']>['perRecord']>['after']
>['handler'];

/** Reads plus the elevated `mutate`/`delete` the build needs to write its four result collections. */
export type PayrollApi = Parameters<CreateAfterHook>[0]['api'];

/**
 * Reads only.
 *
 * `create.before`, `create.after` and an export pipeline are each handed a differently-shaped
 * capability set, and only the relational query surface is common to all three. Anything that only
 * reads is typed against this so it can be called from any of them.
 */
export type PayrollReadApi = { readonly db: Pick<PayrollApi['db'], 'query'> };

/** The largest page any single engine query will pull. A run that exceeds it is a run that lies. */
export const PAGE_LIMIT = 20_000;

/**
 * Read accounting, for profiling.
 *
 * Every engine read is an RPC out of the tenant runtime container before it is a query, so the
 * count of reads matters as much as the rows they return. `assertComplete` wraps every one of
 * them, which makes it the one place that sees them all.
 *
 * The accounting is scoped to one run (or one precheck) rather than module-lifetime: two builds
 * running concurrently must not append to one shared ledger, and an idle module must not keep
 * holding a previous run's rows. Each entry point binds its own ledger for the duration of its
 * work — see `withReadLog`.
 */
export type ReadLog = {
	/** Read a page and refuse to continue silently if it was truncated. */
	readonly assertComplete: <T>(rows: readonly T[], what: string) => readonly T[];
	readonly logString: () => string;
};

function createReadLog(): ReadLog {
	const reads: { what: string; rows: number }[] = [];
	return {
		assertComplete(rows, what) {
			reads.push({ what, rows: rows.length });
			if (rows.length >= PAGE_LIMIT)
				throw new Error(
					`Payroll reached its ${PAGE_LIMIT.toLocaleString('en')}-row ceiling loading ${what}. ` +
						'Split the run rather than trusting a truncated read.'
				);
			return rows;
		},
		logString() {
			const total = reads.reduce((sum, read) => sum + read.rows, 0);
			return `${reads.length} reads, ${total.toLocaleString('en')} rows [${reads
				.map((read) => `${read.what}:${read.rows}`)
				.join(' ')}]`;
		}
	};
}

/**
 * Bind a per-call read log to a capability set, so a caller passing a raw hook `api` hands every
 * engine read the accounting **this entry point** owns and nobody else's rows leak into its log.
 */
export function withReadLog<A extends PayrollReadApi>(api: A): A & { readonly reads: ReadLog } {
	return { ...api, reads: createReadLog() };
}

/** Group rows by a derived key, preserving insertion order within each bucket. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
	const grouped = new Map<K, T[]>();
	for (const row of rows) {
		const value = key(row);
		const bucket = grouped.get(value);
		if (bucket) bucket.push(row);
		else grouped.set(value, [row]);
	}
	return grouped;
}
