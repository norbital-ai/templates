import { refuse } from '@norbital-ai/bolt/authoring';
import { guardEffectiveRange } from '../../lib/effective_range.js';
import type { Api, Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): jurisdiction =, code =, effective range &&.
 *
 * The database is the guarantee — `statutory_contributions_no_overlap` in +model.ts rejects an
 * overlap with SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This
 * hook is the message: it fails first and names the row and the clash instead of raising a raw
 * constraint violation.
 */

/** The stored rows that share a candidate's exclusion key. */
const siblings = (api: Api, jurisdiction_id: string, code: string) =>
	api.db.statutory_contributions.findMany({
		where: { jurisdiction_id: { eq: jurisdiction_id }, code: { eq: code } }
	});

/** The exclusion key as a stored row holds it. */
type Keyed = Readonly<{ jurisdiction_id: string; code: string }>;

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a statutory contribution scheme whose effective range overlaps another scheme with the same code in the same jurisdiction, so a deduction like EPF or SOCSO resolves to one scheme per date. A change of law must become an end-date plus a successor row, never two versions in force at once.',
				handler: ({ input, existing, api }) => {
					// One resolution of the key for both operations: a create states it, an edit may omit
					// it and keep what is stored. `refuse` returns `never`, so both narrow below.
					const jurisdiction_id = input.jurisdiction_id ?? existing?.jurisdiction_id;
					const code = input.code ?? existing?.code;
					if (jurisdiction_id == null || code == null)
						refuse('A statutory contribution states a jurisdiction and a code.');
					return guardEffectiveRange(
						siblings(api, jurisdiction_id, code),
						input.effective_range ?? existing?.effective_range,
						`statutory contribution ${code} in this jurisdiction`,
						input,
						// Undefined on a create, so the row excludes nothing; on an edit it excludes itself,
						// which is what lets a row keep the range it already holds.
						existing?.id
					);
				}
			}
		}
	}
} satisfies Hooks;
