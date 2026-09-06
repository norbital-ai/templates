import { Effect, Schema } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { retireDueLeavePlanPredecessors } from '../lib/leave/reconcile.js';
import {
	leaveAsOf,
	refreshCompaniesLeave,
	refreshEmploymentsLeave,
	refreshLawFamilyLeave,
	type LeaveApi
} from '../lib/leave/service.js';

/**
 * The leave reconciler: the one automation that writes the leave ledger.
 *
 * On the first day of each month it runs the leave-entitlement service over every active
 * employment, a page of 100 at a time: monthly accruals post, next year's accounts open on the
 * company's leave-year boundary, carry transfers and expires, exits settle. The after hooks of
 * employments, terms, children, leave requests and event accounts start it for their employment
 * the moment a fact commits, a sealed statutory profile starts it for its law family, and the seed
 * starts it once its facts are loaded. It can also be started by hand.
 */
export default defineAutomation(
	{ schedule: '10 0 1 * *' },
	{
		input: Schema.Struct({
			company_id: Schema.optional(Schema.String),
			employment_ids: Schema.optional(Schema.Array(Schema.String)),
			jurisdiction_code: Schema.optional(Schema.String)
		}),
		policies: ['leave_reconciliation_automation'],
		description:
			'The leave reconciler: runs the leave-entitlement service over every active employment on the first of each month, over one company or named employments when started by hand or by a hook, and over a law family when a statutory profile is sealed.',
		handler: (api, { args }) =>
			Effect.gen(function* () {
				const asOf = yield* leaveAsOf;
				if (args?.employment_ids != null) {
					const counts = yield* refreshEmploymentsLeave(
						api as unknown as LeaveApi,
						args.employment_ids,
						asOf
					);
					return { employments: args.employment_ids.length, ...counts };
				}
				if (args?.jurisdiction_code != null) {
					const employments = yield* refreshLawFamilyLeave(
						api as unknown as LeaveApi,
						args.jurisdiction_code,
						asOf
					);
					return { jurisdiction_code: args.jurisdiction_code, employments };
				}
				const companies = yield* api.db.companies.findMany({
					where: {
						approval_id: { isNull: true },
						...(args?.company_id == null ? {} : { id: { eq: args.company_id } })
					},
					columns: { id: true },
					limit: 1_000
				});
				const plansRetired = yield* retireDueLeavePlanPredecessors(api, asOf);
				const employments = yield* refreshCompaniesLeave(
					api as unknown as LeaveApi,
					companies.map((row) => row.id),
					asOf
				);
				return { companies: companies.length, employments, plans_retired: plansRetired };
			})
	}
);
