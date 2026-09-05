import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { reconcileStatutoryProfileChange } from './statutory-leave-profile-change.js';

export default defineAutomation(
	{ trigger: { collection: 'jurisdictions', event: 'created' } },
	{
		policies: ['leave_reconciliation_automation'],
		description: 'Fans an approved sealed statutory successor into affected leave accounts.',
		handler: (api, { scope }) => reconcileStatutoryProfileChange(api, scope.incoming_record)
	}
);
