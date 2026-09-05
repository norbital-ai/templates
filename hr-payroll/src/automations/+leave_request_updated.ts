import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileLeaveRequestLedger } from '../lib/leave/reconcile.js';

export default defineAutomation(
	{ trigger: { collection: 'leave_requests', event: 'updated' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Posts only the correcting delta when an uncaptured leave application changes.',
		handler: (api, { scope }) => reconcileLeaveRequestLedger(api, scope.incoming_record)
	}
);
