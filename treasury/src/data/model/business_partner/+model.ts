import { model } from '@norbital-ai/bolt';
/**
 * A business partner the group buys from or sells to. The name is kept as the bank writes it on its advice; other spellings
 * seen on advices and old records are its aliases. Which banks accept invoice financing for it is Treasury's call.
 */
export default model('business_partner', {
	was: 'supplier',
	description: 'One business partner, acting as a supplier, customer or both.',
	icon: 'lucide:contact-round',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		role: { kind: 'enum', values: ['supplier', 'customer', 'both'], default: 'supplier' },
		aliases: { kind: 'text', many: true, optional: true },
		country: { kind: 'text', optional: true },
		payment_terms: { kind: 'text', optional: true },
		products: { kind: 'text', optional: true },
		relationship_since: { kind: 'date', optional: true },
		notes: { kind: 'text', optional: true },
		is_active: { kind: 'bool', default: true }
	},
	constraints: {
		partner_name: { unique: ['name'], import_key: true }
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
			'role',
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
			'role',
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
