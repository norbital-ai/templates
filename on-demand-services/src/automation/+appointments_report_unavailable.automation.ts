import { automation } from '@norbital-ai/bolt';
import { declineShift } from '../lib/appointment-recovery.js';

export default automation({
	description:
		'Records that the assigned provider is unavailable for the day and triggers replacement recommendations.',
	input: {
		targets: { kind: 'ref', to: 'appointments', many: true, min_items: 1 }
	},
	policies: ['operations'],
	run: declineShift
});
