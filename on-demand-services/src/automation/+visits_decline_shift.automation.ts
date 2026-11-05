import { automation } from '@norbital-ai/bolt';
import { declineShift, ownVisits } from '../lib/visit-recovery.js';

export default automation('visits_decline_shift', {
	description:
		'The helper says they cannot work their visits that day. Dispatch proposes replacements for controller approval.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		mc: { kind: 'bool' }
	},
	policies: ['helper_shift'],
	run: function* (input, ctx) {
		yield* ownVisits(ctx, input.targets);
		return yield* declineShift(input, ctx);
	}
});
