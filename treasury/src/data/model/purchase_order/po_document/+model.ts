import { model } from '@norbital-ai/bolt';
/**
 * A file on a purchase order: the PO itself, the purchaser's supporting documents for an LC, the
 * LC the bank issues, or the supplier's commercial invoice.
 */
export default model('po_document', {
	description: 'A file kept on a purchase order.',
	icon: 'lucide:paperclip',
	record_label: 'record.title',
	fields: {
		po: { kind: 'ref', to: 'purchase_order', inverse: 'documents', on_delete: 'cascade' },
		kind: {
			kind: 'enum',
			values: ['purchase_order', 'supporting', 'issued_lc', 'commercial_invoice', 'other'],
			default: 'supporting'
		},
		title: { kind: 'text' },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '10MiB'
		},
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', po: { fields: ['po_number'] } }
	},
	create: { fields: ['po', 'kind', 'title', 'file', 'notes'] },
	update: { fields: ['kind', 'title', 'file', 'notes'] }
});
