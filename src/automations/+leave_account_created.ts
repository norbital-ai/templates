import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileEventAccountOpening } from '../lib/leave/reconcile.js';

export default defineAutomation(
	{ trigger: { collection: 'leave_accounts', event: 'created' } },
	{
		policies: ['leave_reconciliation_automation'],
		description:
			'Posts the opening ledger movement after a reviewed qualifying-event account is committed.',
		handler: (api, { scope }) => reconcileEventAccountOpening(api, scope.incoming_record)
	}
);
