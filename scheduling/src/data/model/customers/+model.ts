import { model } from '@norbital-ai/bolt';

const columns = ['name', 'phone', 'email', 'address', 'location', 'notes'] as const;

/**
 * Customer directory record keyed by unique mobile number for portal recognition and outbound
 * WhatsApp/email notifications.
 */
export default model('customers', {
	description: 'A customer: contact details and default service address.',
	icon: 'lucide:user-round',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', max: 160 },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text', max: 500 },
		location: { kind: 'point', optional: true },
		notes: { kind: 'text', max: 2000, optional: true }
	},
	constraints: { phone: { unique: ['phone'] } },
	indexes: { find: { text: ['name', 'phone', 'email', 'address'] } },
	outputs: {
		default: { fields: 'all' },
		customer: { fields: ['name', 'phone', 'email', 'address', 'location'] },
		provider: { fields: ['name', 'email', 'phone', 'address'] }
	},
	create: { fields: columns },
	update: { fields: columns },
	delete: {}
});
