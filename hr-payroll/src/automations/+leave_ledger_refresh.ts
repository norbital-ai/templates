import { Effect, Schema } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { leaveAsOf, refreshCompaniesLeave, type LeaveApi } from '../lib/leave/service.js';

/** Employments one run works before handing the rest to the next run of the walk. */
const SLICE = 25;

/**
 * The leave reconciler: the automation that posts time's passage to the leave ledger.
 *
 * On the first day of each month it runs the leave-entitlement service over every active
 * employment with today's date, a page of 100 at a time: monthly accruals post, next year's
 * entitlements open on the leave-year boundary, carry transfers and expires, exits settle. A
 * catalogue edit starts it for every company on the settings lineage, the seed starts it once its facts are loaded, and it
 * can be started by hand. A person's own facts never start it: an employment, its terms, a child
 * and a leave request each carry their ledger in their own write (`employments/+hooks.ts`).
 */
export default defineAutomation(
	{ schedule: '10 0 1 * *' },
	{
		input: Schema.Struct({
			company_id: Schema.optional(Schema.String),
			/** Every company bound to this settings lineage; a catalogue edit starts the walk this way. */
			settings_code: Schema.optional(Schema.String),
			/** Where the previous run of this walk stopped; set only by the reconciler itself. */
			cursor: Schema.optional(
				Schema.Struct({ company_id: Schema.String, after: Schema.optional(Schema.String) })
			),
			/** Employments per run; the default is the deadline's worth, a test sets it to one. */
			slice: Schema.optional(Schema.Number)
		}),
		policies: ['leave_reconciliation_automation'],
		description:
			'The leave reconciler: runs the leave-entitlement service over every active employment on the first of each month, and over one company when a catalogue row changes or it is started by hand.',
		handler: (api, { args }) =>
			Effect.gen(function* () {
				const asOf = yield* leaveAsOf;
				const companyIds = (yield* api.db.companies.findMany({
					where: {
						approval_id: { isNull: true },
						...(args?.company_id == null ? {} : { id: { eq: args.company_id } }),
						...(args?.settings_code == null ? {} : { settings_code: { eq: args.settings_code } })
					},
					columns: { id: true },
					limit: 1_000
				})).map((row) => row.id);
				const walked = yield* refreshCompaniesLeave(api as unknown as LeaveApi, companyIds, asOf, {
					slice: args?.slice ?? SLICE,
					...(args?.cursor == null ? {} : { cursor: args.cursor })
				});
				if (walked.next !== undefined)
					// The rest of the walk is its own task, so no single run outgrows its deadline. It is
					// started now, not deferred: the runtime refuses a delayed start, and with a bank-sized
					// seed the deferral silently ended the walk after the first slice of 25.
					yield* api.automations.run('leave_ledger_refresh', {
						...(args ?? {}),
						cursor: walked.next
					});
				return {
					companies: companyIds.length,
					employments: walked.employments,
					continued: walked.next !== undefined
				};
			})
	}
);
