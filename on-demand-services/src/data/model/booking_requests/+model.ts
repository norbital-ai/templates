import { model } from '@norbital-ai/bolt';
import { AREAS, REPEATS } from '../../../lib/matching.js';

/**
 * A booking asked for on the public portal by someone with no account. The `portal_intake` run books it when a helper
 * is free at the time asked, and otherwise leaves it for the desk to follow up.
 */
export default model({
	description: 'A booking request from the public portal, and what became of it.',
	icon: 'lucide:inbox',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'RQ-{yyyy}-{0000}' },
		name: { kind: 'text', max: 200 },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text', max: 500 },
		area: { kind: 'enum', values: AREAS },
		start: { kind: 'instant' },
		repeat: { kind: 'enum', values: REPEATS, default: 'once' },
		notes: { kind: 'text', max: 2000, optional: true },
		status: {
			kind: 'state',
			initial: 'received',
			states: {
				received: { to: ['booked', 'follow_up'] },
				follow_up: { to: ['booked', 'closed'] },
				booked: { edit: 'none' },
				closed: { edit: 'none' }
			}
		},
		/** Why it was not booked on its own. */
		outcome: { kind: 'text', optional: true }
	},
	index: ['status']
});
