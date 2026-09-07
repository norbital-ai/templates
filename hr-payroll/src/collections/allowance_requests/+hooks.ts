import { Effect } from 'effect';
import {
	assertPayRequestAdmissible,
	assertPayRequestDeletable,
	type PayRequestGuard
} from '../../lib/pay_request_hooks.js';
import type { AllowanceRecurrence } from '../../datatypes/allowance_recurrence/+definition.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/**
 * The one family with no date column, so its day is read off the recurrence.
 *
 * A one-off's day is the first of the period it names and a recurring allowance's is the day its
 * window opens. Storing that beside the recurrence would be a second statement of the same fact,
 * free to disagree with the first — which is exactly what happened when a one-off was written as a
 * recurring allowance whose range happened to span one month.
 *
 * Everything the catalogue decides and the settlement lock are shared with the other four request
 * collections, in `src/lib/pay_request_hooks.ts`.
 */
const recurrenceDay = (value: unknown): string | null => {
	if (value == null || typeof value !== 'object') return null;
	const recurrence = value as AllowanceRecurrence;
	return recurrence.kind === 'ONE_OFF'
		? dateKey(`${recurrence.period}-01`)
		: dateKey(recurrence.from);
};

const GUARD: PayRequestGuard = {
	family: 'ALLOWANCE',
	noun: 'allowance',
	sign: 1,
	eventDate: (candidate) => recurrenceDay(candidate.recurrence),
	capture: (api, id) =>
		api.db.payslip_allowance_request_inputs.findFirst({
			where: { allowance_request_id: { eq: id } },
			columns: { period: true }
		}),
	siblings: (api, employmentId, componentId) =>
		api.db.allowance_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				component_catalogue_id: { eq: componentId },
				approval_id: { isNull: true }
			},
			columns: { id: true, component_catalogue_id: true, amount: true, recurrence: true },
			limit: 10_000
		})
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses an allowance against a component that takes no requests or a different request family, a non-positive amount, one past its entitlement ceiling, and any change to one a payroll run has already captured.',
				handler: ({ input, existing, api }) =>
					Effect.map(assertPayRequestAdmissible(GUARD, { api, input, existing }), () => input)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting an allowance a payroll run has already captured. Corrections are new rows.',
				handler: ({ existing, api }) => assertPayRequestDeletable(GUARD, api, existing.id)
			}
		}
	}
} satisfies Hooks;
