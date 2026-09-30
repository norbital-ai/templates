import { model } from '@norbital-ai/bolt';

/**
 * Google's drive time from one ~1 km square to another (`lib/matching.ts` `legOf`), fetched by the `check_drives` run
 * for every leg a helper's day will be driven. Matching reads it; a leg not here is estimated from straight-line distance.
 */
export default model({
	description: 'Google drive times between ~1 km squares, read by matching.',
	icon: 'lucide:route',
	label: 'leg',
	fields: {
		/** `<lat>,<lng>><lat>,<lng>`, each rounded to 0.01°. */
		leg: { kind: 'text', unique: true },
		minutes: { kind: 'int', min: 0 }
	}
});
