import { Effect } from 'effect';
import {
	assertPayRequestAdmissible,
	assertPayRequestDeletable,
	type PayRequestGuard
} from '../../lib/pay_request_hooks.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/**
 * The day the expense was incurred, which is a column now: a claim that does not say when cannot be written at all, where it used to be a hook refusal over a jsonb path.
 *
 * Everything the catalogue decides — that the component takes requests, that it takes *this*
 * family, evidence, the entitlement ceiling — and the settlement lock are shared with the other
 * four request collections, in `src/lib/pay_request_hooks.ts`. What is family-specific is exactly
 * the two lines below: which column dates the row, and which junction captures it.
 */
const GUARD: PayRequestGuard = {
	family: 'CLAIM',
	noun: 'claim',
	/**
	 * Every row of this family counts against a cap in one direction.
	 */
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.incurred_on as string | null),
	capture: (api, id) =>
		api.db.payslip_claim_request_inputs.findFirst({
			where: { claim_request_id: { eq: id } },
			columns: { period: true }
		}),
	siblings: (api, employmentId, componentId) =>
		api.db.claim_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				component_catalogue_id: { eq: componentId },
				approval_id: { isNull: true }
			},
			columns: { id: true, component_catalogue_id: true, amount: true, incurred_on: true },
			limit: 10_000
		})
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a claim against a component that takes no requests or a different request family, an unevidenced one where the component demands evidence, a non-positive amount, a request past its entitlement ceiling, and any change to one a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.map(assertPayRequestAdmissible(GUARD, { api, input, existing }), () => input)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a claim a payroll run has already captured. Corrections are new rows.',
				handler: ({ existing, api }) => assertPayRequestDeletable(GUARD, api, existing.id)
			}
		}
	}
} satisfies Hooks;
