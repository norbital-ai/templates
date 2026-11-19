import { model } from '@norbital-ai/bolt';
import { paymentDay } from '../../../lib/purchasing.js';

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
 * item, and when Treasury pays it (a Tuesday when urgent, else a Friday) unless it needs no financing. It can start
 * as just its PDF: filing the PO document reads it into the empty fields and, while the order has
 * no items, its item lines. Supplier invoices are recorded against it with their quantities per item and checked
 * back against it; the lines that pay it are linked from either side. A purchaser sees only the orders they raised
 * (`created_by`) and can change one until its first invoice is recorded.
 */
export default model('purchase_order', {
	description: 'A purchase order raised on a supplier.',
	icon: 'lucide:file-text',
	record_label: "record.po_number != null ? record.po_number : 'Purchase order'",
	fields: {
		po_number: { kind: 'text', max: 60, optional: true },
		po_date: { kind: 'date', optional: true },
		supplier: { kind: 'ref', to: 'business_partner', inverse: 'purchase_orders', optional: true },
		salesperson: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		ship_to_country: { kind: 'text', optional: true },
		lc_requested: { kind: 'bool', default: false },
		is_cancelled: { kind: 'bool', default: false },
		/** When Treasury pays it: a Tuesday (urgent) or a Friday. */
		payment_date: { kind: 'date', optional: true },
		/** Paid without a bank line (e.g. cash), so no earmark is wanted. */
		no_financing: { kind: 'bool', default: false },
		notes: { kind: 'text', optional: true },
		amount: { kind: 'sum', of: 'lines.amount' },
		quantity: { kind: 'sum', of: 'lines.quantity' },
		invoiced_amount: { kind: 'sum', of: 'invoices.amount' },
		invoice_count: { kind: 'count', of: 'invoices' }
	},
	constraints: {
		po_number: { unique: ['po_number'] }
	},
	outputs: {
		default: {
			fields: 'all',
			supplier: { fields: ['name', 'country'] },
			lines: { fields: ['item', 'quantity', 'amount', 'invoiced_quantity'] },
			invoices: {
				fields: [...INVOICE_FIELDS],
				lines: { fields: ['po_line', 'quantity', 'amount'] },
				drawdown: {
					fields: ['supplier', 'amount', 'invoiced_amount', 'bank_reference', 'product', 'currency']
				}
			},
			documents: { fields: ['kind', 'file'] },
			financings: {
				fields: ['drawdown'],
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
			'salesperson',
			'currency',
			'ship_to_country',
			'lc_requested',
			'payment_date',
			'notes'
		],
		lines: { fields: ['item', 'quantity', 'amount'] },
		documents: { fields: ['kind', 'file'] },
		transform: function* (changes, ctx) {
			const row = changes.findIndex((c) => !paymentDay(c.after.payment_date ?? null));
			if (row >= 0) return yield* ctx.refuse('errors.payment_day', { row });
			return changes.map((c) => c.set);
		}
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
			'payment_date',
			'no_financing',
			'notes'
		],
		lines: { fields: ['item', 'quantity', 'amount'] },
		// a payment date already on the order stays; a new one is a Tuesday or a Friday
		transform: function* (changes, ctx) {
			const row = changes.findIndex(
				(c) => c.changed('payment_date') && !paymentDay(c.after.payment_date ?? null)
			);
			if (row >= 0) return yield* ctx.refuse('errors.payment_day', { row });
			return changes.map((c) => c.set);
		},
		invoices: { fields: [...INVOICE_FIELDS], lines: { fields: ['po_line', 'quantity', 'amount'] } }
	}
});
