import { model } from '@norbital-ai/bolt';
export default model({
	description: 'source_sales_lines',
	label: 'reference',
	fields: {
		lot_number: { kind: 'text', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		external_code: { kind: 'text' },
		// The approved snapshot owns this identity; an editable draft row may be removed.
		order_line: { kind: 'text' },
		kind: { kind: 'enum', values: ['shipment', 'return', 'invoice_only'] },
		reference: { kind: 'text' },
		business_on: { kind: 'date' },
		source_updated_at: { kind: 'instant' },
		seal_hash: { kind: 'text' },
		unit: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3 },
		currency: { kind: 'currency' },
		net_amount: { kind: 'money', currency: 'currency', optional: true },
		tax_amount: { kind: 'money', currency: 'currency', optional: true },
		freight: { kind: 'money', currency: 'currency', optional: true },
		active: { kind: 'bool', default: true }
	},
	key: ['source', 'external_code']
});
