import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Supplier invoice booked against a confirmed purchase order — the accounts-payable side of the buy. Carries the supplier’s own invoice number as `invoice_reference` and snapshots the supplier like the order did. Confirming it is the three-way match checkpoint: its lines allocate ordered quantities, goods receipts prove what arrived, and the totals are what gets paid.',
	icon: 'lucide:receipt',
	label: 'doc_no',
	fields: {
		doc_no: { kind: 'seq', pattern: 'PI-{yyyy}-{0000}' },
		supplier_code: { kind: 'text' },
		supplier_name: { kind: 'text' },
		invoice_reference: { kind: 'text', optional: true },
		invoice_date: { kind: 'date', optional: true },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['confirmed', 'cancelled'] },
				confirmed: { edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		currency: { kind: 'currency', optional: true },
		tax_inclusive: { kind: 'bool' },
		net: { kind: 'sum', of: 'purchase_invoice_lines.net' },
		tax: { kind: 'sum', of: 'purchase_invoice_lines.tax' },
		gross: { kind: 'sum', of: 'purchase_invoice_lines.line_total' },
		lines: { kind: 'count', of: 'purchase_invoice_lines' },
		confirmed_at: { kind: 'instant', optional: true },
		cancelled_at: { kind: 'instant', optional: true },
		cancel_reason: { kind: 'text', optional: true }
	},
	index: ['status'],
	search: { text: ['doc_no'] }
});
