import { guardEffectiveRange } from '../../lib/effective_range.js';
import type { HookApi, Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): company =, code =, effective range &&.
 *
 * The database is the guarantee — `leave_types_no_overlap` in +model.ts rejects an overlap with
 * SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This hook is the
 * message: it fails first and names the row and the clash instead of raising a raw constraint
 * violation.
 */

/** The stored rows that share a candidate's exclusion key. */
const siblings = (api: HookApi, company_id: string, code: string) =>
	api.db.query.leave_types.findMany({
		where: { company_id: { eq: company_id }, code: { eq: code } }
	});

/** The exclusion key as a stored row holds it. */
type Keyed = Readonly<{ company_id: string; code: string }>;

/** An edit carries only the fields it changes, so the key is read through the stored row. */
const editedSiblings = (
	api: HookApi,
	input: Readonly<{ company_id?: string | null; code?: string | null }>,
	existing: Keyed
) => siblings(api, input.company_id ?? existing.company_id, input.code ?? existing.code);

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a leave type whose effective range overlaps another leave type with the same code in the same company, so one code never resolves to two entitlement rules on one date.',
				handler: ({ input, api }) =>
					guardEffectiveRange(
						siblings(api, input.company_id, input.code),
						input.effective_range,
						`leave type ${input.code}`,
						input
					)
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited leave type so changing its code, company or effective range cannot leave two versions of the same leave code in force together.',
				handler: ({ input, existing, api }) =>
					guardEffectiveRange(
						editedSiblings(api, input, existing),
						input.effective_range ?? existing.effective_range,
						`leave type ${input.code ?? existing.code}`,
						input,
						existing.id
					)
			}
		}
	}
} satisfies Hooks;
