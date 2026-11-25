import { model } from '@norbital-ai/bolt';

/**
 * Cached Google Routes drive times between ~1 km squares (`lib/matching.ts` `legOf`). Populated
 * automatically by `check_drives` and `prepare_availability`; missing legs fall back to Haversine.
 */
export default model('drive_times', {
	description: 'Cached Google Routes drive minutes between ~1 km grid cells for scheduling.',
	icon: 'lucide:route',
	record_label: 'record.leg',
	fields: {
		leg: { kind: 'text', hidden: true },
		minutes: { kind: 'int', min: 0 }
	},
	constraints: { leg: { unique: ['leg'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: ['leg', 'minutes'] }
});
