import { model } from '@norbital-ai/bolt';
/**
 * A supplier the group buys from and finances. The name is kept as the bank writes it on its advice; other spellings
 * seen on advices and old records are its aliases. Which banks accept invoice financing for it is Treasury's call.
 */
export default model('supplier', {
	description: 'A supplier paid through a bank facility.',
	icon: 'lucide:truck',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		aliases: { kind: 'text', many: true, optional: true },
		country: { kind: 'text', optional: true },
		payment_terms: { kind: 'text', optional: true },
		products: { kind: 'text', optional: true },
		relationship_since: { kind: 'date', optional: true },
		notes: { kind: 'text', optional: true },
		is_active: { kind: 'bool', default: true }
	},
	constraints: {
		supplier_name: { unique: ['name'], import_key: true }
	},
	indexes: { by_name: { text: ['name', 'aliases'] } },
	outputs: {
		default: {
			fields: 'all',
			eligible_banks: { fields: ['bank'], bank: { fields: ['code', 'name'] } }
		}
	},
	create: {
		fields: [
			'name',
			'aliases',
			'country',
			'payment_terms',
			'products',
			'relationship_since',
			'notes',
			'is_active'
		],
		eligible_banks: { fields: ['bank'] }
	},
	update: {
		fields: [
			'name',
			'aliases',
			'country',
			'payment_terms',
			'products',
			'relationship_since',
			'notes',
			'is_active'
		],
		eligible_banks: { fields: ['bank'] }
	}
});
