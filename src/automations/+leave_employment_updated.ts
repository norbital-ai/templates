import { Clock, Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileEmploymentLeave } from '../lib/leave/reconcile.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';

export default defineAutomation(
	{ trigger: { collection: 'employments', event: 'updated' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Reconciles leave accounts after employment eligibility dates change.',
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
