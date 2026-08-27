/**
 * The database surface the engine runs against.
 *
 * The build happens in `mutate.prepare` and `mutate.before`, which hold **reads only**. That is not
 * a restriction the engine works around — it is the design. A payroll run writes exactly one thing,
 * the graph its `before` hook returns, and the runtime performs that write as part of the create.
 * An engine that cannot call `mutate` cannot have a side effect, so "no side effects" stops being a
 * rule somebody has to keep and becomes a type.
 *
 * Deriving the type from the hook signature rather than restating it keeps this honest — if the
 * platform narrows what a `before` hook may do, this stops compiling instead of failing at run time.
 */

import type { Hooks } from '../$types.js';

type MutateBeforeHook = NonNullable<
	NonNullable<NonNullable<Hooks['mutate']>['perRecord']>['before']
>['handler'];

/**
 * Reads. There is no write half.
 *
 * This used to be `PayrollApi` — the elevated after-hook capability set, with `mutate` and
 * `delete` on every collection — and four functions in `persist.ts` used it. All four are gone: the
 * payslips, their lines and their settlement locks are children of the graph `create.before`
 * returns, and the arrears entries that were the only writes outside that graph are derived now
 * rather than carried forward.
 */
export type PayrollReadApi = Parameters<MutateBeforeHook>[0]['api'];

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
