import { model } from '@norbital-ai/bolt';
/**
 * A purchase order raised by a purchaser: supplier, ship-to country, whether it is to be paid by LC,
 * and one line per item. Supplier invoices are recorded against it and checked back against it.
 * `purchaser` records who raised it, so each purchaser sees
 * only their own orders.
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
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		po_number: { unique: ['po_number'], import_key: true }
	},
	outputs: {
		default: {
			fields: 'all',
			supplier: { fields: ['name', 'country'] },
			lines: { fields: ['item', 'quantity', 'amount'] },
			invoices: {
				fields: ['invoice_number', 'invoice_date', 'currency', 'amount', 'bank_bill_number']
			},
			documents: { fields: ['kind', 'title'] }
		}
	},
	create: {
		fields: [
			'po_number',
			'po_date',
			'supplier',
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
			'salesperson',
			'currency',
			'ship_to_country',
			'lc_requested',
			'is_cancelled',
			'notes'
		],
		lines: { fields: ['item', 'quantity', 'amount'] },
		invoices: {
			fields: [
				'invoice_number',
				'invoice_date',
				'currency',
				'amount',
				'bank_bill_number',
				'drawdown',
				'notes'
			]
		}
	}
});
