import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads each entity’s configured holiday source and adds the holidays a Google calendar names that the entity does not have yet, unpublished. It cannot publish, change or delete a holiday.',
	grants: {
		companies: { read: true },
		jurisdiction_holidays: {
			read: true,
			create: { fields: ['company_id', 'date', 'name', 'replaces', 'source'] }
		}
	},
	limits: AUTOMATION_LIMITS
});
