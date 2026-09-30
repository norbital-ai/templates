import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Purchase document — the buying pipeline. Moves draft→submitted→confirmed, with cancelled as a terminal state before confirmation. A confirmed order is the state the system of record books; it is terminal, which is what makes its figures safe to hand across the boundary.',
	icon: 'lucide:shopping-cart',
	label: 'doc_no',
	fields: {
		doc_no: { kind: 'seq', pattern: 'PO-{yyyy}-{0000}' },
		supplier_code: { kind: 'text' },
		supplier_name: { kind: 'text' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['submitted', 'cancelled'] },
				submitted: {
					to: ['confirmed', 'cancelled'],
					edit: ['confirmed_at', 'cancelled_at', 'cancel_reason']
				},
				confirmed: { edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		currency: { kind: 'currency', optional: true },
		tax_inclusive: { kind: 'bool' },
		expected_date: { kind: 'date', optional: true },
		net: { kind: 'sum', of: 'purchase_order_lines.net' },
		tax: { kind: 'sum', of: 'purchase_order_lines.tax' },
		gross: { kind: 'sum', of: 'purchase_order_lines.line_total' },
		lines: { kind: 'count', of: 'purchase_order_lines' },
		confirmed_at: { kind: 'instant', optional: true },
		cancelled_at: { kind: 'instant', optional: true },
		cancel_reason: { kind: 'text', optional: true }
	},
	index: ['status', 'expected_date'],
	search: { text: ['doc_no'] }
});
