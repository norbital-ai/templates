import { model } from '@norbital-ai/bolt';

/**
 * Published open start times for one active service on one day, exposed anonymously to portal
 * visitors without disclosing provider schedules or customer records.
 */
export default model('openings', {
	description: 'Published open start times for one service on one calendar day.',
	icon: 'lucide:calendar-clock',
	record_label: "record.service.name + ' · ' + string(record.day)",
	fields: {
		service: { kind: 'ref', to: 'services', inverse: 'openings', owned: true },
		day: { kind: 'date' },
		starts: { kind: 'text', many: true, hidden: true }
	},
	constraints: { one_per_day: { unique: ['service', 'day'] } },
	outputs: {
		default: { fields: 'all', service: { fields: ['name'] } },
		portal: { fields: ['service', 'day', 'starts'] }
	},
	create: { fields: ['service', 'day', 'starts'] },
	update: { fields: ['starts'] },
	delete: {}
});
