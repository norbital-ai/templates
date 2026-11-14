import { model } from '@norbital-ai/bolt';
/**
 * Part of a facility's limit reserved for one product or one supplier.
 */
export default model('sub_limit', {
	description: 'Part of a facility limit reserved for a product or a supplier.',
	icon: 'lucide:split',
	record_label: 'record.name',
	fields: {
		facility: { kind: 'ref', to: 'facility', inverse: 'sub_limits', on_delete: 'cascade' },
		name: { kind: 'text' },
		product: { kind: 'text', optional: true },
		supplier: {
			kind: 'ref',
			to: 'supplier',
			inverse: 'sub_limits',
			optional: true,
			on_delete: 'set_null'
		},
		limit: { kind: 'decimal', scale: 2 },
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', facility: { fields: ['name'] } }
	},
	create: { fields: ['facility', 'name', 'product', 'supplier', 'limit', 'notes'] },
	update: { fields: ['facility', 'name', 'product', 'supplier', 'limit', 'notes'] }
});
