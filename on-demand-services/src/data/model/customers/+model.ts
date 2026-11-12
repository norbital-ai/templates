import { model } from '../../../../.norbital/models/customers.ts';
import { AREAS } from '../../../lib/matching.js';
const columns = ['name', 'phone', 'email', 'address', 'location', 'area', 'notes'] as const;
/**
 * A customer, known by their mobile number: it is unique, it is how a portal request finds them, and it is where their
 * notices go (WhatsApp; email as well when they gave one).
 */
export default model({
	description: 'A customer: contact details and the default service address.',
	icon: 'lucide:house',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: { phone: { unique: ['phone'] } },
	indexes: { find: { text: ['name', 'phone', 'email', 'address'] } },
	outputs: {
		default: { fields: 'all' },
		customer: { fields: ['name', 'phone', 'email', 'address', 'location', 'area'] },
		helper: { fields: ['name', 'email', 'phone', 'address'] }
	},
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } },
	delete: {}
});
