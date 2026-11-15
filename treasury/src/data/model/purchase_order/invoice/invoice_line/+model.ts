import { model } from '@norbital-ai/bolt';
/** What one invoice bills against one PO item: quantity (kg) and amount. */
export default model('invoice_line', {
	description: 'One PO item on a supplier invoice.',
	icon: 'lucide:list',
	record_label: 'record.po_line.item',
	fields: {
		invoice: { kind: 'ref', to: 'invoice', inverse: 'lines', on_delete: 'cascade' },
		po_line: { kind: 'ref', to: 'po_line', inverse: 'invoice_lines', on_delete: 'restrict' },
		quantity: { kind: 'decimal', scale: 3, min: 0 },
		amount: { kind: 'decimal', scale: 2, min: 0 }
	},
	outputs: {
		default: { fields: 'all', po_line: { fields: ['item'] } }
	}
});
