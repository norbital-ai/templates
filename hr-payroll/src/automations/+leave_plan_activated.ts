import { Clock, Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileCompanyLeave } from '../lib/leave/reconcile.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';
import { readRange } from '../collections/payroll_runs/lib/effective.js';

export default defineAutomation(
	{ trigger: { collection: 'leave_plans', event: 'updated' } },
	{
		policies: ['leave_reconciliation_automation'],
		description:
			'Reconciles an approved plan immediately, retiring its predecessor only when the successor is in force.',
		handler: (api, { scope }) =>
			scope.incoming_record.lifecycle !== 'ACTIVE' || scope.incoming_record.approval_id != null
				? Effect.succeed({ skipped: true })
				: Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const asOf = calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE);
						const starts = readRange(scope.incoming_record.effective_range)?.start;
						if (scope.incoming_record.supersedes_id != null && starts != null && starts <= asOf)
							yield* api.db.leave_plans.mutate([
								{ id: scope.incoming_record.supersedes_id, lifecycle: 'RETIRED' }
							]);
						return yield* reconcileCompanyLeave(api, scope.incoming_record.company_id, asOf);
					})
	}
);
