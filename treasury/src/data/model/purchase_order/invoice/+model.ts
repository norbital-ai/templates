import { model } from '@norbital-ai/bolt';
/**
 * A supplier invoice, keyed in from the bank's returned documents and checked back against the
 * purchase order it was raised on.
 */
export default model('invoice', {
	description: 'A supplier invoice recorded against a purchase order.',
	icon: 'lucide:receipt-text',
	record_label: 'record.invoice_number',
	fields: {
		po: { kind: 'ref', to: 'purchase_order', inverse: 'invoices', on_delete: 'cascade' },
		invoice_number: { kind: 'text', max: 60 },
		invoice_date: { kind: 'date' },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2 },
		bank_bill_number: { kind: 'text', optional: true },
		drawdown: {
			kind: 'ref',
			to: 'drawdown',
			inverse: 'invoices',
			optional: true,
			on_delete: 'set_null'
		},
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			po: { fields: ['po_number'] },
			drawdown: { fields: ['bank_reference'] }
		}
	}
});
