import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/** Leave rules are editable only while their company-plan version is an unapproved DRAFT. */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Allows leave rules only inside an unapproved DRAFT company plan and keeps the row in the plan’s legal entity.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						if (row.account_basis === 'EVENT') {
							if (row.accrual?.kind !== 'UPFRONT' || row.accrual.carry != null)
								refuse(
									'Event-based leave uses one verified opening award and never accrues or carries.'
								);
							if (
								row.event_window_months != null &&
								(!Number.isInteger(row.event_window_months) || row.event_window_months <= 0)
							)
								refuse('An event window must be a positive number of months.');
						} else if (row.event_window_months != null || row.event_unit === 'WEEKS') {
							refuse('Only event-based leave has an event window or week-based allocation.');
						}
						const planId = input.leave_plan_id ?? existing?.leave_plan_id;
						if (planId == null) refuse('A leave type belongs to a company leave-plan version.');
						if (
							existing != null &&
							input.leave_plan_id != null &&
							input.leave_plan_id !== existing.leave_plan_id
						) {
							const prior = yield* api.db.leave_plans.findFirst({
								where: { id: { eq: existing.leave_plan_id } }
							});
							if (prior?.lifecycle !== 'DRAFT' || prior.approval_id != null)
								refuse('A sealed leave rule cannot be moved. Copy it into a successor DRAFT plan.');
						}
						const plan = yield* api.db.leave_plans.findFirst({ where: { id: { eq: planId } } });
						if (plan == null) refuse('The selected leave plan does not exist.');
						if (plan.lifecycle !== 'DRAFT' || plan.approval_id != null)
							refuse('The selected leave plan is sealed. Create a successor DRAFT plan.');
						if ((input.company_id ?? existing?.company_id) !== plan.company_id)
							refuse('A leave type and its plan must belong to the same legal entity.');
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Only an unapproved DRAFT plan may have leave rules removed.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						const plan = yield* api.db.leave_plans.findFirst({
							where: { id: { eq: existing.leave_plan_id } }
						});
						if (plan?.lifecycle !== 'DRAFT' || plan.approval_id != null)
							refuse('A sealed leave rule cannot be deleted.');
					})
			}
		}
	}
} satisfies Hooks;
