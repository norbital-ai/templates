import { Effect } from 'effect';
import { assertNoOverlap } from '../../lib/effective_range.js';
import type { Hooks } from './$types.js';

/**
 * Exclusion key (plan 02 §7): company =, code =, effective range &&.
 *
 * The database is the guarantee — `leave_types_no_overlap` in +model.ts rejects an overlap with
 * SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This hook is the
 * message: it fails first and names the row and the clash instead of raising a raw constraint
 * violation.
 */
export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a leave type whose effective range overlaps another leave type with the same code in the same company, so one code never resolves to two entitlement rules on one date.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						const existing = yield* api.db.query.leave_types.findMany({
							where: { company_id: { eq: input.company_id }, code: { eq: input.code } }
						});
						assertNoOverlap({
							candidate: input.effective_range,
							existing,
							identity: `leave type ${input.code}`
						});
						return input;
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited leave type so changing its code, company or effective range cannot leave two versions of the same leave code in force together.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const company_id = input.company_id ?? existing.company_id;
						const code = input.code ?? existing.code;
						const effective_range = input.effective_range ?? existing.effective_range;
						const siblings = yield* api.db.query.leave_types.findMany({
							where: { company_id: { eq: company_id }, code: { eq: code } }
						});
						assertNoOverlap({
							candidate: effective_range,
							existing: siblings,
							identity: `leave type ${code}`,
							excludeId: existing.id
						});
						return input;
					})
			}
		}
	}
} satisfies Hooks;
