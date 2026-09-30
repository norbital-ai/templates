import { model } from '@norbital-ai/bolt';

/**
 * When a service can start on one day: the half-hour starts at which some helper with its skill is free, published by
 * the `publish_openings` run for the booking portal. It names no helper and no other customer.
 */
export default model({
	description: 'The open start times of one service on one day, as the booking portal offers them.',
	icon: 'lucide:calendar-clock',
	label: 'day',
	fields: {
		day: { kind: 'date' },
		/** Instants, earliest first. */
		starts: { kind: 'text', many: true }
	},
	unique: [{ fields: ['service', 'day'] }]
});
