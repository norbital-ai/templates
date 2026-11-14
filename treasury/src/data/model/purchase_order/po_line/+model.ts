import { model } from '@norbital-ai/bolt';
/** One item on a purchase order: what was ordered, how much of it (kg) and for how much. */
export default model('po_line', {
	description: 'One item line on a purchase order.',
	icon: 'lucide:list',
	record_label: 'record.item',
	fields: {
		po: { kind: 'ref', to: 'purchase_order', inverse: 'lines', on_delete: 'cascade' },
		item: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3 },
		amount: { kind: 'decimal', scale: 2 }
	},
	outputs: {
		default: { fields: 'all', po: { fields: ['po_number'] } }
	}
});
