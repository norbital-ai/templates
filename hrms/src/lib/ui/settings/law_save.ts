import type { PageContext } from '@norbital-ai/bolt/page';
import { corrected, opens, type Change, type Depth } from '../../dated.js';
import { LAW_DEPTH, standing, type Law } from '../../law.js';
import { isJsonObject, jsonObject, type JsonObject } from '../../payroll_engine/foundation.js';

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
	effective_from: row.effective_from,
	patch: isJsonObject(row.law) ? row.law : {}
});

/** The changes the law is folded from: a change written by research counts only while its finding is confirmed. */
export const standingChanges = (chain: readonly LawChange[]): readonly LawChange[] =>
	chain.filter((row) => standing(jsonObject(row)));

/** A patch laid over the patch a change already holds; a `null` stays, for the fold to take the value away. */
const merged = (
	held: JsonObject,
	patch: JsonObject,
	depth: Depth,
	prefix: readonly string[] = []
): JsonObject => ({
	...held,
	...Object.fromEntries(
		Object.entries(patch).map(([key, value]) => {
			const was = held[key];
			return [
				key,
				isJsonObject(value) && isJsonObject(was) && opens(depth, [...prefix, key])
					? merged(was, value, depth, [...prefix, key])
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
	const same = chain.find((row) => row.effective_from === from && row.finding_id == null);
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
