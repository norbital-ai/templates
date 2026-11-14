import { model } from '@norbital-ai/bolt';
/**
 * A supplier the group buys from and finances. Names are kept as the bank writes them on its advice.
 */
export default model('supplier', {
	description: 'A supplier paid through a bank facility.',
	icon: 'lucide:truck',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		country: { kind: 'text', optional: true },
		payment_terms: { kind: 'text', optional: true },
		products: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true },
		is_active: { kind: 'bool', default: true }
	},
	constraints: {
		supplier_name: { unique: ['name'], import_key: true }
	},
	outputs: {
		default: { fields: 'all' }
	},
	create: {
		fields: ['name', 'country', 'payment_terms', 'products', 'notes', 'is_active']
	},
	update: {
		fields: ['name', 'country', 'payment_terms', 'products', 'notes', 'is_active']
	}
});
