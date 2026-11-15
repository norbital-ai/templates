import { model } from '@norbital-ai/bolt';
/** A bank that accepts invoice financing for a supplier. */
export default model('supplier_bank', {
	description: 'A bank that accepts invoice financing for a supplier.',
	icon: 'lucide:badge-check',
	record_label: 'record.bank.code',
	fields: {
		supplier: { kind: 'ref', to: 'supplier', inverse: 'eligible_banks', on_delete: 'cascade' },
		bank: { kind: 'ref', to: 'bank', inverse: 'eligible_suppliers', on_delete: 'cascade' }
	},
	constraints: {
		one_per_pair: { unique: ['supplier', 'bank'] }
	},
	outputs: {
		default: { fields: 'all', supplier: { fields: ['name'] }, bank: { fields: ['code'] } }
	}
});
