import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { restateEmploymentFor } from '../../lib/leave/service.js';
import { readLeaveContext, type LeaveContext } from '../../lib/leave/entitlements.js';

/**
 * A child fact is an append-only personal fact, and the scaling statutory leave floors compute
 * against it.
 *
 * - **Update refuses outright**: a correction appends a row whose `supersedes_id` names the fact
 *   it fixes, so what was believed at every point stays on the record and a paid run's floor is
 *   reconstructable from immutable facts as of its own date.
 * - **Delete refuses**: a fact a derived balance has ever consumed is history; supersede instead.
 * - The birth date is immutable by being stated once at creation; the age cutoffs laws state
 *   (`under 7`, `under 18`) are computed from it as of each date.
 *
 * A child changes what the employment is entitled to, so the fact and the ledger it implies
 * commit together: `before` plans the employment with the pending child in hand and restates the
 * employment root through `api.db.employments.mutate`, staged into this same graph as the
 * workspace's own work (`employments/+hooks.ts` keeps a ledger it is handed). No automation is
 * started and the person needs no grant on the ledger.
 */
export default {
	mutate: {
		prepare: ({ inputs, api }): Effect.Effect<{ readonly context: LeaveContext }> =>
			Effect.map(
				readLeaveContext(
					api,
					inputs.flatMap((one) => (one.employment_id == null ? [] : [one.employment_id])),
					{}
				),
				(context) => ({ context })
			),
		perRecord: {
			before: {
				description:
					'Refuses updating or deleting a child fact (corrections append a superseding row), so the facts a derived leave balance was computed from stay immutable; restates the employment with the entitlements this child opens, in the same commit.',
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						if (existing !== undefined)
							refuse(
								'A child fact is an append-only record and cannot be edited or deleted. ' +
									'Append a fact whose supersedes_id names this one.'
							);
						if (input.supersedes_id != null) {
							const previous = yield* api.db.employee_children.findFirst({
								where: { id: { eq: input.supersedes_id } }
							});
							if (previous == null || previous.employment_id !== input.employment_id)
								refuse('A child correction must replace a fact belonging to the same employment.');
						}
						yield* restateEmploymentFor(api, prepared.context, 'employee_children', {
							...input,
							id: recordId,
							approval_id: null
						});
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Keeps child facts as history; corrections supersede them.',
				handler: () => refuse('A child fact cannot be deleted. Append a correcting fact instead.')
			}
		}
	}
} satisfies Hooks<{ readonly context: LeaveContext }>;
