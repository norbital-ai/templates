import { Clock, Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileEmploymentLeave } from '../lib/leave/reconcile.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';

export default defineAutomation(
	{ trigger: { collection: 'employments', event: 'created' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Creates current and next-year leave accounts when an employment is approved.',
		handler: (api, { scope }) =>
			Effect.flatMap(Clock.currentTimeMillis, (now) =>
				reconcileEmploymentLeave(
					api,
					scope.incoming_record.id,
					calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE)
				)
			)
	}
);
