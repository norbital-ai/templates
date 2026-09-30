import type { CollectionName } from '@norbital-ai/bolt';
import { everyField } from './every-field.js';
import { plainRows } from './wire.js';
import * as Predicate from 'effect/Predicate';

/**
 * What a transform's `ctx.db` (as the workspace) and a query's, action's or automation's `ctx` (as the caller) both
 * offer: `read` (§3.4), name-erased so one reader serves every body.
 */
export type Reads = {
	read(collection: never, q: never): Promise<{ readonly rows: readonly unknown[] }>;
};

/** A top-level `{ in: [] }` matches nothing, so the read is not made. */
const matchesNothing = (where: object): boolean =>
	Object.values(where).some(
		(clause) =>
			Predicate.isObjectOrArray(clause) &&
			Array.isArray((clause as { in?: unknown }).in) &&
			(clause as { in: unknown[] }).in.length === 0
	);

/**
 * The page a whole-row read takes of a collection whose history grows with every run and whose rows carry large
 * `custom` values, so one company's rows outgrow one crossing's 4 MiB answer. Measured on the Nihon company's first run
 * (84 people): a payslip is 10–23 KB of JSON (its `statutory` lines 16 KB), 1.6 MB a run, and the run's own
 * `calculation_trace` repeats every person's scheme inputs; a second run's unpaged whole-row reads crossed 4 MiB.
 * ponytail: a single run row past 4 MiB (a trace of several hundred people) still refuses; split the trace per slip then.
 */
const WIDE_ROWS: Partial<Record<CollectionName, number>> = {
	payroll_runs: 1,
	payslips: 50,
	leave_entries: 1000,
	work_days: 1000
};

/**
 * Every row of `collection` that matches `where`, whole (every field named: a caller's default projection omits
 * `json` and `custom` values, X-33): in one read (rule 9: an explicit `all`), or `page` rows at a time where the rows
 * are too large for one crossing's 4 MiB answer (a lineage's statutory tables, and by default a whole-row read of a
 * `WIDE_ROWS` collection). Each page is a crossing.
 */
export async function readAll<T>(
	reads: Reads,
	collection: CollectionName,
	where: object,
	page?: number,
	narrowed?: object
): Promise<T[]> {
	if (matchesNothing(where)) return [];
	const select = narrowed ?? everyField(collection);
	page ??= narrowed === undefined ? WIDE_ROWS[collection] : undefined;
	if (page === undefined)
		return plainRows<T>(
			await reads.read(collection as never, { where, select, all: true } as never)
		);
	const rows: T[] = [];
	let after: unknown = null;
	do {
		const answer = (await reads.read(
			collection as never,
			{
				where,
				select,
				limit: page,
				...(after == null ? {} : { after })
			} as never
		)) as { readonly rows: readonly unknown[]; readonly next?: unknown };
		rows.push(...plainRows<T>(answer));
		after = answer.next ?? null;
	} while (after != null);
	return rows;
}
