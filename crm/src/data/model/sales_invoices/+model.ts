import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Billing document raised against a confirmed quote — the sales side of accounts receivable. One quote may bill over several invoices as allocated quantities allow; an issued invoice is terminal, which is what makes its figures safe to hand across the boundary.',
	icon: 'lucide:file-text',
	label: 'doc_no',
	fields: {
		doc_no: { kind: 'seq', pattern: 'SI-{yyyy}-{0000}' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['issued', 'cancelled'] },
				issued: { edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		currency: { kind: 'currency', optional: true },
		tax_inclusive: { kind: 'bool' },
		net: { kind: 'sum', of: 'sales_invoice_lines.net' },
		tax: { kind: 'sum', of: 'sales_invoice_lines.tax' },
		gross: { kind: 'sum', of: 'sales_invoice_lines.line_total' },
		lines: { kind: 'count', of: 'sales_invoice_lines' },
		issued_at: { kind: 'instant', optional: true },
		cancelled_at: { kind: 'instant', optional: true },
		cancel_reason: { kind: 'text', optional: true }
	},
	index: ['status'],
	search: { text: ['doc_no'] }
});
