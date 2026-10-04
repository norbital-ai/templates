import { model } from '@norbital-ai/bolt';
import { AREAS } from '../../../lib/matching.js';

/**
 * A customer, known by their mobile number: it is unique, it is how a portal request finds them, and it is where their
 * notices go (WhatsApp; email as well when they gave one).
 */
export default model({
	description: 'A customer: contact details and the default service address.',
	icon: 'lucide:house',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		phone: { kind: 'text', format: 'phone', unique: true },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		notes: { kind: 'text', optional: true }
	},
	search: { text: ['name', 'phone', 'email', 'address'] }
});
