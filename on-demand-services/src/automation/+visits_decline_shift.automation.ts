import { automation } from '@norbital-ai/bolt';
import { declineShift } from '../lib/visit-recovery.js';

export default automation('visits_decline_shift', {
	description:
		'The helper says they cannot work their visits that day. Dispatch proposes replacements for controller approval.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		mc: { kind: 'bool' }
	},
	runAs: 'trigger',
	run: declineShift
});
