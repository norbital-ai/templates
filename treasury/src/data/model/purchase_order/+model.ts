import { model } from '@norbital-ai/bolt';

const INVOICE_FIELDS = [
	'invoice_number',
	'invoice_date',
	'currency',
	'amount',
	'bank_bill_number',
	'drawdown',
	'notes'
] as const;

/**
 * A purchase order raised by a purchaser: supplier, ship-to country, whether it is to be paid by LC, and one line per
 * item. Supplier invoices are recorded against it with their quantities per item and checked back against it; the
 * lines that pay it are linked from either side. A purchaser sees only the orders they raised (`created_by`) and can
 * change one until its first invoice is recorded.
 */
export default model('purchase_order', {
	description: 'A purchase order raised on a supplier.',
	icon: 'lucide:file-text',
	record_label: 'record.po_number',
	fields: {
		po_number: { kind: 'text', max: 60 },
		po_date: { kind: 'date' },
		supplier: { kind: 'ref', to: 'supplier', inverse: 'purchase_orders' },
		purchaser: { kind: 'text', optional: true },
		salesperson: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		ship_to_country: { kind: 'text', optional: true },
		lc_requested: { kind: 'bool', default: false },
		is_cancelled: { kind: 'bool', default: false },
		notes: { kind: 'text', optional: true },
		amount: { kind: 'sum', of: 'lines.amount' },
		quantity: { kind: 'sum', of: 'lines.quantity' },
		invoiced_amount: { kind: 'sum', of: 'invoices.amount' },
		invoice_count: { kind: 'count', of: 'invoices' },
		lc_links: { kind: 'count', of: 'financings', where: { is_lc: { eq: true } } }
	},
	constraints: {
		po_number: { unique: ['po_number'], import_key: true }
	},
	outputs: {
		default: {
			fields: 'all',
			supplier: { fields: ['name', 'country'] },
			lines: { fields: ['item', 'quantity', 'amount', 'invoiced_quantity'] },
			invoices: {
				fields: [...INVOICE_FIELDS],
				lines: { fields: ['po_line', 'quantity', 'amount'] },
				drawdown: { fields: ['supplier', 'amount', 'bank_reference', 'product', 'currency'] }
			},
			documents: { fields: ['kind', 'title', 'file'] },
			financings: {
				fields: ['drawdown', 'is_lc'],
				drawdown: {
					fields: [
						'bank_reference',
						'product',
						'currency',
						'amount',
						'status',
						'lc_number',
						'due_date'
					]
				}
			}
		}
	},
	create: {
		fields: [
			'po_number',
			'po_date',
			'supplier',
			'purchaser',
			'salesperson',
			'currency',
			'ship_to_country',
			'lc_requested',
			'notes'
		],
		lines: { fields: ['item', 'quantity', 'amount'] }
	},
	update: {
		fields: [
			'po_number',
			'po_date',
			'supplier',
			'purchaser',
			'salesperson',
			'currency',
			'ship_to_country',
			'lc_requested',
			'is_cancelled',
			'notes'
		],
		lines: { fields: ['item', 'quantity', 'amount'] },
		invoices: { fields: [...INVOICE_FIELDS], lines: { fields: ['po_line', 'quantity', 'amount'] } }
	}
});
