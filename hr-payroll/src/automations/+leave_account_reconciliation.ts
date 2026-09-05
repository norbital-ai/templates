import { Clock, Effect } from 'effect';
import { defineAutomation, refuse } from '@norbital-ai/bolt/authoring';
import {
	reconcileEmploymentLeave,
	retireDueLeavePlanPredecessors
} from '../lib/leave/reconcile.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';

const PAGE = 500;

export default defineAutomation(
	{ schedule: '20 0 * * *' },
	{
		policies: ['leave_reconciliation_automation'],
		description:
			'Daily idempotent repair sweep: activates due plan succession, creates missing current/next-year accounts and posts policy, statutory, carry and expiry deltas.',
		handler: (api) =>
			Effect.gen(function* () {
				const asOf = calendarDateInTimeZone(
					new Date(yield* Clock.currentTimeMillis),
					PAYROLL_TIME_ZONE
				);
				const plansRetired = yield* retireDueLeavePlanPredecessors(api, asOf);
				let after: string | undefined;
				let employments = 0;
				let accounts = 0;
				let entries = 0;
				while (employments < 50_000) {
					const page = yield* api.db.employments.findMany({
						where: {
							...(after == null ? {} : { id: { gt: after } }),
							approval_id: { isNull: true }
						},
						columns: { id: true },
						orderBy: { id: 'asc' },
						limit: PAGE
					});
					for (const employment of page) {
						after = employment.id;
						const result = yield* reconcileEmploymentLeave(api, employment.id, asOf);
						employments += 1;
						accounts += result.accounts_created;
						entries += result.entries_posted;
					}
					if (page.length < PAGE)
						return {
							plans_retired: plansRetired,
							employments,
							accounts_created: accounts,
							entries_posted: entries
						};
				}
				return refuse(
					'Leave reconciliation exceeds 50,000 employments in one sweep. Shard the tenant before retrying.'
				);
			})
	}
);
