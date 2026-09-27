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
 * Every row of `collection` that matches `where`, whole (every field named: a caller's default projection omits
 * `json` and `custom` values, X-33): in one read (rule 9: an explicit `all`), or `page` rows at a time where the rows
 * are too large for one crossing's 4 MiB answer (a lineage's statutory tables). Each page is a crossing.
 */
export async function readAll<T>(
	reads: Reads,
	collection: CollectionName,
	where: object,
	page?: number,
	select: object = everyField(collection)
): Promise<T[]> {
	if (matchesNothing(where)) return [];
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
