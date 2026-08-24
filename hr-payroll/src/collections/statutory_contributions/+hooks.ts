import { guardEffectiveRange } from '../../lib/effective_range.js';
import type { HookApi, Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): jurisdiction =, code =, effective range &&.
 *
 * The database is the guarantee — `statutory_contributions_no_overlap` in +model.ts rejects an
 * overlap with SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This
 * hook is the message: it fails first and names the row and the clash instead of raising a raw
 * constraint violation.
 */

/** The stored rows that share a candidate's exclusion key. */
const siblings = (api: HookApi, jurisdiction_id: string, code: string) =>
	api.db.query.statutory_contributions.findMany({
		where: { jurisdiction_id: { eq: jurisdiction_id }, code: { eq: code } }
	});

/** The exclusion key as a stored row holds it. */
type Keyed = Readonly<{ jurisdiction_id: string; code: string }>;

/** An edit carries only the fields it changes, so the key is read through the stored row. */
const editedSiblings = (
	api: HookApi,
	input: Readonly<{ jurisdiction_id?: string | null; code?: string | null }>,
	existing: Keyed
) => siblings(api, input.jurisdiction_id ?? existing.jurisdiction_id, input.code ?? existing.code);

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a statutory contribution scheme whose effective range overlaps another scheme with the same code in the same jurisdiction, so a deduction like EPF or SOCSO resolves to one scheme per date.',
				handler: ({ input, api }) =>
					guardEffectiveRange(
						siblings(api, input.jurisdiction_id, input.code),
						input.effective_range,
						`statutory contribution ${input.code} in this jurisdiction`,
						input
					)
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited contribution scheme so a change of law becomes an end-date plus a successor row rather than two versions of one scheme code in force together.',
				handler: ({ input, existing, api }) =>
					guardEffectiveRange(
						editedSiblings(api, input, existing),
						input.effective_range ?? existing.effective_range,
						`statutory contribution ${input.code ?? existing.code} in this jurisdiction`,
						input,
						existing.id
					)
			}
		}
	}
} satisfies Hooks;
