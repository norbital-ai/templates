import { model } from '../../../../../.norbital/models/openings.ts';
/**
 * When a service can start on one day: the half-hour starts at which some helper with its skill is free, published by
 * the `publish_openings` run (its only writer) for the booking portal. It names no helper and no other customer.
 */
export default model({
	description: 'The open start times of one service on one day, as the booking portal offers them.',
	icon: 'lucide:calendar-clock',
	record_label: 'string(record.day)',
	fields: {
		service: { kind: 'ref', to: 'services', inverse: 'openings', owned: true },
		day: { kind: 'date' },
		/** Instants, earliest first. */
		starts: { kind: 'text', many: true, hidden: true }
	},
	constraints: { one_per_day: { unique: ['service', 'day'] } },
	outputs: {
		default: { fields: 'all', service: { fields: ['name'] } },
		portal: { fields: ['service', 'day', 'starts'] }
	},
	create: { columns: { fields: ['service', 'day', 'starts'] } },
	update: { columns: { fields: ['starts'] } },
	delete: {}
});
