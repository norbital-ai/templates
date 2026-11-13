import type { PageContext } from '@norbital-ai/bolt/page';
import { corrected, type Change } from '../../dated.js';
import { LAW_DEPTH, standing, type Law } from '../../law.js';
import {
	isJsonObject,
	jsonObject,
	stableJson,
	type Json,
	type JsonObject
} from '../../payroll_engine/foundation.js';

/** One law's changes, live: every row, whether or not its finding stands. */
export const lawChain = (ctx: PageContext, code: string) =>
	ctx.query({
		jurisdiction_change: {
			where: { jurisdiction_code: { eq: code } },
			fields: ['jurisdiction_code', 'effective_from', 'finding_id', 'law', 'revision'],
			limit: 10000,
			finding_id: { fields: ['status'] }
		}
	});
export type LawChange = NonNullable<
	ReturnType<typeof lawChain>['current']
>['jurisdiction_change']['rows'][number];

/** A row as the fold reads it. */
export const changeOf = (row: LawChange): Change => ({
	id: row.id,
	effective_from: String(row.effective_from),
	patch: isJsonObject(row.law) ? row.law : {}
});

/** The changes the law is folded from: a change written by research counts only while its finding is confirmed. */
export const standingChanges = (chain: readonly LawChange[]): readonly LawChange[] =>
	chain.filter((row) => standing(jsonObject(row)));

/**
 * The patch that turns `before` into `after`, both shaped as the law document: a changed value whole, a value gone as
 * `null`. Read as deep as the law is folded, so a row keeps the fields the edit left alone.
 */
export const patchOf = (before: JsonObject, after: JsonObject, depth = LAW_DEPTH): JsonObject =>
	Object.fromEntries(
		[...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
			(key): (readonly [string, Json])[] => {
				const was = before[key];
				const now = after[key];
				if (now === undefined || now === null)
					return was === undefined || was === null ? [] : [[key, null]];
				if (depth > 1 && isJsonObject(now)) {
					const inner = patchOf(isJsonObject(was) ? was : {}, now, depth - 1);
					return Object.keys(inner).length === 0 ? [] : [[key, inner]];
				}
				return stableJson(was) === stableJson(now) ? [] : [[key, now]];
			}
		)
	);

/** A patch laid over the patch a change already holds; a `null` stays, for the fold to take the value away. */
const merged = (held: JsonObject, patch: JsonObject, depth: number): JsonObject => ({
	...held,
	...Object.fromEntries(
		Object.entries(patch).map(([key, value]) => {
			const was = held[key];
			return [
				key,
				depth > 1 && isJsonObject(value) && isJsonObject(was)
					? merged(was, value, depth - 1)
					: value
			];
		})
	)
});

/**
 * The writes of one save. `from` null: it was always so, and each value goes on the change that set it. A date: it
 * changes from then, on the change already written by hand for that date, else on a new one.
 */
export const lawWrites = (
	chain: readonly LawChange[],
	law: Law,
	patch: JsonObject,
	from: string | null
) => {
	if (from === null) {
		const live = standingChanges(chain);
		const next = corrected(live.map(changeOf), law.set_by, patch, LAW_DEPTH);
		return {
			update: live.flatMap((row) => {
				const held = next.get(row.id);
				return held === undefined ? [] : [{ target: row, set: { law: held } }];
			}),
			create: []
		};
	}
	const same = chain.find((row) => String(row.effective_from) === from && row.finding_id == null);
	return same === undefined
		? {
				update: [],
				create: [{ jurisdiction_code: law.code, effective_from: from, law: patch }]
			}
		: {
				update: [{ target: same, set: { law: merged(changeOf(same).patch, patch, LAW_DEPTH) } }],
				create: []
			};
};
