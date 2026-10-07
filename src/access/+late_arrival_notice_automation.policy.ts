import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads roster, shift, employment, entity and committed leave to send late-arrival notices to the production manager.',
	grants: {
		roster_entry: { read: true },
		shift_definition: { read: true },
		employment_contract: { read: true },
		employment_profile: { read: true },
		entity: { read: true },
		leave_catalog_entry: { read: true }
	},
	limits: AUTOMATION_LIMITS
});
