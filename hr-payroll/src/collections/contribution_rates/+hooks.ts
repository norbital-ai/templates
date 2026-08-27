import type { Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): contribution =, **selector range &&**, effective range &&.
 *
 * Two-dimensional: two bands of one contribution may share an effective range as long as their
 * selectors do not overlap, and may share a selector as long as their effective ranges do not.
 * Only the pair overlapping in BOTH dimensions is a duplicate.
 *
 * The database is the guarantee — `contribution_rates_no_overlap` in +model.ts projects the same
 * key out of the JSONB selector and rejects an overlap with SQLSTATE 23P01 whatever path the write
 * takes, including a concurrent one or another row in the same createMany statement. Bolt translates
 * that constraint into a caller-facing overlap refusal. A SELECT precheck here would be weaker and
 * add one database round trip per rate to bulk statutory tables.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a contribution band whose wage, age or risk-class selector overlaps another band of the same statutory contribution over the same effective range, so no wage can match two rates at once. Re-checked on every edit, because a widened selector or effective range makes two rates of one scheme apply to the same wage.',
				handler: ({ input }) => input
			}
		}
	}
} satisfies Hooks;
