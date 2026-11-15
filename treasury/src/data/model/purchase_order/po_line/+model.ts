import { model } from '@norbital-ai/bolt';
/** One item on a purchase order: what was ordered, how much of it (kg), for how much, and how much is invoiced. */
export default model('po_line', {
	description: 'One item line on a purchase order.',
	icon: 'lucide:list',
	record_label: 'record.item',
	fields: {
		po: { kind: 'ref', to: 'purchase_order', inverse: 'lines', on_delete: 'cascade' },
		item: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3, min: 0 },
		amount: { kind: 'decimal', scale: 2, min: 0 },
		invoiced_quantity: { kind: 'sum', of: 'invoice_lines.quantity' }
	},
	outputs: {
		default: { fields: 'all', po: { fields: ['po_number'] } }
	}
});
