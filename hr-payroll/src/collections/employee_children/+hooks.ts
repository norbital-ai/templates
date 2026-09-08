import { withContractInput } from '../../lib/employment-contract.js';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/** Personal facts remain immutable; leave queries read their effective history directly. */

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating or deleting a child fact (corrections append a superseding row), so entitlement queries and historical payroll retain the original evidence.',
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
						return withContractInput(input, existing);
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
