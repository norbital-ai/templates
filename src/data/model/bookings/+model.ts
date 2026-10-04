import { model } from '@norbital-ai/bolt';
import { AREAS, REPEATS } from '../../../lib/matching.js';

/**
 * One customer order: a service at an address, once or recurring, with or without preferred helpers. Each occurrence is
 * a visit; the booking holds what they share.
 */
export default model({
	description:
		'A booking: customer, service, address, preference and repeat. Its visits are the occurrences.',
	icon: 'lucide:calendar-check',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'BK-{yyyy}-{0000}' },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		preference: { kind: 'enum', values: ['any', 'preferred'] },
		repeat: { kind: 'enum', values: REPEATS },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['cancelled'] }, cancelled: { edit: 'none' } }
		},
		notes: { kind: 'text', optional: true },
		visit_count: { kind: 'count', of: 'visits' }
	},
	index: ['status']
});
