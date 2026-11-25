import { automation } from '@norbital-ai/bolt';
import { declineShift, ownAppointments } from '../lib/appointment-recovery.js';

export default automation({
	description:
		'The provider reports they cannot work their scheduled appointments for the day so dispatch can propose replacements.',
	input: {
		targets: { kind: 'ref', to: 'appointments', many: true, min_items: 1 }
	},
	policies: ['provider_shift'],
	run: function* (input, ctx) {
		yield* ownAppointments(ctx, input.targets);
		return yield* declineShift(input, ctx);
	}
});
