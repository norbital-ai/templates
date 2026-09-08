import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { dateKey } from '../../lib/iso-day.js';
import { withContractInput } from '../../lib/employment-contract.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Record a contract departure without editing the contract or creating any financial entry.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (existing) refuse('A recorded departure cannot be edited.');
						if (!input.employment_id || !input.exit_date || !input.exit_reason)
							refuse('Departure requires a contract, last employment date and reason.');
						const contract = yield* api.db.employments.findFirst({
							where: { id: { eq: input.employment_id } }
						});
						if (!contract) refuse('The employment contract does not exist.');
						if (dateKey(input.exit_date) < dateKey(contract.hire_date))
							refuse('Departure cannot precede the contract hire date.');
						return withContractInput(input);
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Keep the departure as part of the contract history.',
				handler: () => refuse('A recorded departure cannot be deleted.')
			}
		}
	}
} satisfies Hooks;
