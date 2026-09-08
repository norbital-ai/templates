import type { Policy } from './$types.js';

export default {
	description:
		'Reads configured jurisdiction holiday sources and prepares or refreshes import evidence on annual drafts. It cannot publish calendars, change observations directly or delete history.',
	grants: {
		jurisdiction_holiday_sources: { read: {} },
		holiday_calendar_inputs: { read: {} },
		jurisdiction_holiday_calendars: {
			read: {},
			mutate: {
				new: { fields: ['jurisdiction_code', 'year', 'revision', 'observations', 'import_review'] },
				existing: { fields: ['import_review'] }
			}
		}
	},
	limits: { 'collections.*': { window: '1 min', limit: 600, key: 'subject' } }
} satisfies Policy;
