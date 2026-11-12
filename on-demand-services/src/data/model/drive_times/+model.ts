import { model } from '../../../../.norbital/models/drive_times.ts';
/**
 * Google's drive time from one ~1 km square to another (`lib/matching.ts` `legOf`), fetched by the `check_drives` run
 * for every leg a helper's day will be driven. Matching reads it; a leg not here is estimated from straight-line distance.
 * Written only by the `check_drives` and `prepare_availability` runs.
 */
export default model({
	description: 'Google drive times between ~1 km squares, read by matching.',
	icon: 'lucide:route',
	record_label: 'string(record.minutes)',
	fields: {
		/** `<lat>,<lng>><lat>,<lng>`, each rounded to 0.01°. */
		leg: { kind: 'text', hidden: true },
		minutes: { kind: 'int', min: 0 }
	},
	constraints: { leg: { unique: ['leg'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: ['leg', 'minutes'] } }
});
