import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileLeaveRequestLedger } from '../lib/leave/reconcile.js';

export default defineAutomation(
	{ trigger: { collection: 'leave_requests', event: 'created' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Posts the TAKEN entry after an approved leave application becomes a real row.',
		handler: (api, { scope }) => reconcileLeaveRequestLedger(api, scope.incoming_record)
	}
);
