import type { WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { refusing, type amendmentsFor, type Touched } from './amendments.js';
import { entriesUndone, entryPostings, entryRead } from './ledger/service.js';
import { jsonObject } from './payroll_engine/foundation.js';

/** The entries priced on their one day (`incurred_on`). */
type Dated = 'claim_catalog_entry' | 'adhoc_catalog_entry';
interface Entry {
	readonly employment_id: string;
	readonly incurred_on: string;
	readonly payroll_run_id?: string | null | undefined;
}
/** The model's own `amendmentsFor`: each amending model names what carries its amendment rows. */
type Amend = (touched: readonly Touched[]) => ReturnType<typeof amendmentsFor>;

/** A run sealing or releasing rows sets only their run: not an edit of them. */
export const sealOnly = (changes: readonly { readonly set: object }[]) =>
	changes.every(({ set }) => Object.keys(set).length === 1 && Object.hasOwn(set, 'payroll_run_id'));

/** The days an entry prices: a paid period holding one is worked out again by the next run. */
const touched = (rows: readonly Entry[]): Touched[] =>
	rows.map((row) => ({
		employment: String(row.employment_id),
		from: String(row.incurred_on),
		run: row.payroll_run_id ?? null
	}));

/** A create's sets, with what the entries post and the amendment rows of the paid periods they touch. */
export const entryCreate = <M extends Dated, S>(
	ctx: WriteCtx<M>,
	model: M,
	changes: readonly { readonly set: S; readonly after: Entry }[],
	amend: Amend
) =>
	Effect.gen(function* () {
		const rows = changes.map((c) => c.after);
		const entries = rows.map((row) => jsonObject(row));
		// the approving decision asks again only for what the entry posts: what it checked stands
		const known = yield* entryRead(ctx.query, model, entries, ctx.approving ? undefined : 'create');
		return {
			sets: changes.map((c) => c.set),
			on_approved: {
				...(yield* entryPostings(known, model, entries)),
				...(yield* amend(touched(rows)))
			}
		};
	});

/** An update's sets, with the difference the entries post and the amendment rows of the paid periods they touch. */
export const entryUpdate = <M extends Dated, S extends object>(
	ctx: WriteCtx<M>,
	model: M,
	changes: readonly {
		readonly before: Entry;
		readonly set: S;
		readonly after: Entry;
		changed(field: 'incurred_on'): boolean;
	}[],
	amend: Amend
) =>
	Effect.gen(function* () {
		if (sealOnly(changes)) return changes.map((change) => change.set);
		const proposed = changes.map((change) => jsonObject(change.after));
		const known = yield* entryRead(
			ctx.query,
			model,
			proposed,
			ctx.approving ? undefined : 'update'
		);
		return {
			// a date that moves leaves the run that priced it: the period it joins prices it, and seals it
			sets: changes.map((c) =>
				c.before.payroll_run_id != null && c.changed('incurred_on')
					? { ...c.set, payroll_run_id: null }
					: c.set
			),
			on_approved: {
				...(yield* entryPostings(known, model, proposed)),
				// a date that moves touches the period it left and the period it joined
				...(yield* amend([
					...touched(changes.map((c) => c.before)),
					...touched(changes.map((c) => c.after))
				]))
			}
		};
	});

/** What a delete carries: the inverse of what the entries posted, and the amendment rows of the paid periods they touched. */
export const entryDelete = <M extends Dated>(
	ctx: WriteCtx<M>,
	model: M,
	changes: readonly { readonly before: Entry }[],
	amend: Amend
) =>
	Effect.gen(function* () {
		const rows = changes.map((change) => change.before);
		const entries = rows.map((row) => jsonObject(row));
		const known = yield* entryRead(
			ctx.query,
			model,
			entries,
			ctx.approving ? undefined : 'delete'
		).pipe(refusing(ctx));
		return {
			on_approved: {
				...entriesUndone(known, model, entries),
				...(yield* amend(touched(rows)))
			}
		};
	});
