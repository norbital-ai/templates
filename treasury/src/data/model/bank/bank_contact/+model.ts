import { model } from '@norbital-ai/bolt';
/** One person at a bank: relationship manager, client service or trade operations. */
export default model('bank_contact', {
	description: 'A person to call at a bank.',
	icon: 'lucide:user-round',
	record_label: 'record.name',
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'contacts', on_delete: 'cascade' },
		role: {
			kind: 'enum',
			values: ['relationship_manager', 'client_service', 'trade_operations', 'other'],
			default: 'other'
		},
		name: { kind: 'text' },
		email: { kind: 'text', format: 'email', optional: true },
		phone: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', bank: { fields: ['code', 'name'] } }
	}
});
