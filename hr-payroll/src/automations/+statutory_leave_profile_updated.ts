import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileStatutoryProfileChange } from './statutory-leave-profile-change.js';

export default defineAutomation(
	{ trigger: { collection: 'jurisdictions', event: 'updated' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Reconciles affected leave accounts when a statutory profile becomes sealed.',
		handler: (api, { scope }) => reconcileStatutoryProfileChange(api, scope.incoming_record)
	}
);
