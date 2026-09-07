import { Effect } from 'effect';
import {
	assertPayRequestAdmissible,
	assertPayRequestDeletable,
	type PayRequestGuard
} from '../../lib/pay_request_hooks.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/**
 * The day the settlement is dated to. The periods it makes good, and the reason, are `notNull` columns — the arm that required both was used zero times in 726 seeded entries, because a bonus did not have to say anything.
 *
 * Everything the catalogue decides — that the component takes requests, that it takes *this*
 * family, evidence, the entitlement ceiling — and the settlement lock are shared with the other
 * four request collections, in `src/lib/pay_request_hooks.ts`. What is family-specific is exactly
 * the two lines below: which column dates the row, and which junction captures it.
 */
const GUARD: PayRequestGuard = {
	family: 'ARREARS',
	noun: 'arrears',
	/**
	 * Every row of this family counts against a cap in one direction.
	 */
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.settled_on as string | null),
	capture: (api, id) =>
		api.db.payslip_arrears_request_inputs.findFirst({
			where: { arrears_request_id: { eq: id } },
			columns: { period: true }
		}),
	siblings: (api, employmentId, componentId) =>
		api.db.arrears_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				component_catalogue_id: { eq: componentId },
				approval_id: { isNull: true }
			},
			columns: { id: true, component_catalogue_id: true, amount: true, settled_on: true },
			limit: 10_000
		})
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a arrears against a component that takes no requests or a different request family, an unevidenced one where the component demands evidence, a non-positive amount, a request past its entitlement ceiling, and any change to one a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.map(assertPayRequestAdmissible(GUARD, { api, input, existing }), () => input)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a arrears a payroll run has already captured. Corrections are new rows.',
				handler: ({ existing, api }) => assertPayRequestDeletable(GUARD, api, existing.id)
			}
		}
	}
} satisfies Hooks;
