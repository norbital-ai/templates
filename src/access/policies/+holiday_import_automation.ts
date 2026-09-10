import type { Policy } from './$types.js';

export default {
	description:
		'Reads each entity’s configured holiday source and adds the holidays a Google calendar names that the entity does not have yet, unpublished. It cannot publish, change or delete a holiday.',
	grants: {
		companies: { read: {} },
		jurisdiction_holidays: {
			read: {},
			mutate: {
				new: { fields: ['company_id', 'date', 'name', 'original_date', 'source'] }
			}
		}
	},
	limits: { 'collections.*': { window: '1 min', limit: 600, key: 'subject' } }
} satisfies Policy;
