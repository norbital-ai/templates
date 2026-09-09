import type { Policy } from './$types.js';

export default {
	description:
		'Reads configured jurisdiction holiday sources and adds the holidays a Google calendar names that the jurisdiction does not have yet, unpublished. It cannot publish, change or delete a holiday.',
	grants: {
		jurisdiction_settings: { read: {} },
		jurisdiction_holidays: {
			read: {},
			mutate: {
				new: { fields: ['jurisdiction_code', 'date', 'name', 'original_date', 'source'] }
			}
		}
	},
	limits: { 'collections.*': { window: '1 min', limit: 600, key: 'subject' } }
} satisfies Policy;
