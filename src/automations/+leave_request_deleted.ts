import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileLeaveRequestLedger } from '../lib/leave/reconcile.js';

export default defineAutomation(
	{ trigger: { collection: 'leave_requests', event: 'deleted' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Posts a RESTORED entry when an uncaptured leave application is withdrawn.',
		handler: (api, { scope }) => reconcileLeaveRequestLedger(api, scope.incoming_record, true)
	}
);
