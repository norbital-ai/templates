import { Effect } from 'effect';
import {
	assertPayRequestAdmissible,
	assertPayRequestDeletable,
	type PayRequestGuard
} from '../../lib/pay_request_hooks.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/**
 * The day the correction is dated to. The settled line it fixes is a `notNull` foreign key, which is what every seeded correction was missing — they loaded because the seed does not cross the authorization boundary, so the only enforcement was a rule on a path the data did not take.
 *
 * Everything the catalogue decides — that the component takes requests, that it takes *this*
 * family, evidence, the entitlement ceiling — the two reads that answer them, and the settlement
 * lock all live in `src/lib/pay_request_hooks.ts`. What is family-specific is exactly what is
 * below: the family this collection is, and which of its columns dates a row.
 */
const GUARD: PayRequestGuard = {
	family: 'CORRECTION',
	noun: 'correction',
	/**
	 * A reversal draws in the opposite direction, so the cap's running total is signed here exactly
	 * as the run signs it. Netting a negative draw against a magnitude would grow the ceiling.
	 */
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.corrected_on as string | null)
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a correction against a component that takes no requests or a different request family, an unevidenced one where the component demands evidence, a non-positive amount, a request past its entitlement ceiling, and any change to one a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.map(assertPayRequestAdmissible(GUARD, { api, input, existing }), () => input)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a correction a payroll run has already captured. Corrections are new rows.',
				handler: ({ existing, api }) => assertPayRequestDeletable(GUARD, api, existing.id)
			}
		}
	}
} satisfies Hooks;
