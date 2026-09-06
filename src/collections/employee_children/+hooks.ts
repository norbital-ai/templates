import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

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
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating or deleting a child fact — corrections append a superseding row, so the facts a derived leave balance was computed from stay immutable.',
				handler: ({ input, existing, api }) =>
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
						return input;
					})
			},
			after: {
				description:
					"A child fact decides childcare and parental entitlements, so the employment's leave is regenerated once it commits.",
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						yield* api.automations.run('leave_ledger_refresh', {
							employment_ids: [record.employment_id]
						});
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
} satisfies Hooks;
