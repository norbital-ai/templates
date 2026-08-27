import { refuse } from '@norbital-ai/bolt/authoring';
import { guardEffectiveRange } from '../../lib/effective_range.js';
import type { Api, Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): company =, code =, effective range &&.
 *
 * The database is the guarantee — `leave_types_no_overlap` in +model.ts rejects an overlap with
 * SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This hook is the
 * message: it fails first and names the row and the clash instead of raising a raw constraint
 * violation.
 */

/** The stored rows that share a candidate's exclusion key. */
const siblings = (api: Api, company_id: string, code: string) =>
	api.db.leave_types.findMany({
		where: { company_id: { eq: company_id }, code: { eq: code } }
	});

/** The exclusion key as a stored row holds it. */
type Keyed = Readonly<{ company_id: string; code: string }>;

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a leave type whose effective range overlaps another leave type with the same code in the same company, so one code never resolves to two entitlement rules on one date. Re-checked on every edit, because changing a code, company or range can put two versions of one code in force together.',
				handler: ({ input, existing, api }) => {
					// One resolution of the key for both operations: a create states it, an edit may omit
					// it and keep what is stored. `refuse` returns `never`, so both narrow below.
					const company_id = input.company_id ?? existing?.company_id;
					const code = input.code ?? existing?.code;
					if (company_id == null || code == null)
						refuse('A leave type states a company and a code.');
					return guardEffectiveRange(
						siblings(api, company_id, code),
						input.effective_range ?? existing?.effective_range,
						`leave type ${code}`,
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
