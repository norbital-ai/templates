import { withContractInput } from '../../lib/employment-contract.js';
import { Effect } from 'effect';
import {
	assertPayRequestAdmissible,
	assertPayRequestDeletable,
	type PayRequestGuard
} from '../../lib/pay_request_hooks.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

const GUARD: PayRequestGuard = {
	family: 'PAYMENT',
	noun: 'payment',
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.effective_on as string | null)
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a payment against a component that takes no requests or a different request family, an unevidenced one where the component demands evidence, a non-positive amount, a request past its entitlement ceiling, and any change to one a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.map(assertPayRequestAdmissible(GUARD, { api, input, existing }), () =>
						withContractInput(input, existing)
					)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a payment a payroll run has already captured. Corrections are new rows.',
				handler: ({ existing, api }) => assertPayRequestDeletable(GUARD, api, existing.id)
			}
		}
	}
} satisfies Hooks;
