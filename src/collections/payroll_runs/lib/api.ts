/**
 * The database surface the engine runs against.
 *
 * The build happens in the run's transform, which holds **reads only**. That is not a restriction
 * the engine works around — it is the design. A payroll run writes exactly one thing, the payload
 * its transform returns, and the runtime performs that write as part of the create. An engine that
 * cannot write cannot have a side effect, so "no side effects" stops being a rule somebody has to
 * keep and becomes a type.
 *
 * The transform's `db` is budgeted to two read waves. The engine asks its questions in many
 * dependent steps, so `preload.ts` reads everything a run can need in two concurrent waves and
 * hands the engine an in-memory surface of the same shape (`lib/memory-reads.ts`).
 */

import type { CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';

/** Reads. There is no write half. */
export type PayrollReadApi = { readonly db: CollectionTransformDatabase };

/** The largest page any single engine query will pull. A run that exceeds it is a run that lies. */
export const PAGE_LIMIT = 20_000;

/**
 * Read accounting, for profiling.
 *
 * Every engine read is answered from the preloaded world, so the count of reads is the count of
 * questions the engine asked, and the rows are what each answer held. `assertComplete` wraps every
 * one of them, which makes it the one place that sees them all.
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
						'The complete input must be loaded before this payroll can be calculated.'
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
 * Bind a per-call read log to a capability set, so a caller passing a raw read `api` hands every
 * engine read the accounting **this entry point** owns and nobody else's rows leak into its log.
 */
export function withReadLog<A extends PayrollReadApi>(api: A): A & { readonly reads: ReadLog } {
	return { ...api, reads: createReadLog() };
}
