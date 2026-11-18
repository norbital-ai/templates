import { model } from '@norbital-ai/bolt';

const written = [
	'external_code',
	'kind',
	'reference',
	'business_on',
	'supplier_code',
	'supplier_name',
	'product_code',
	'product_name',
	'lot_number',
	'warehouse_code',
	'unit',
	'quantity',
	'currency',
	'net_amount',
	'tax_amount',
	'order_reference',
	'upstream',
	'billed_amount',
	'open_amount',
	'due_on',
	'paid_on',
	'active',
	'source',
	'source_updated_at'
] as const;
export default model('source_purchase_lines', {
	description:
		'Kingdee purchase receipt and invoice lines, with each invoice’s payable: read-only.',
	record_label: 'record.reference',
	fields: {
		// `<kind>:<document id>:<entry>`
		external_code: { kind: 'text' },
		kind: { kind: 'enum', values: ['receipt', 'invoice'] },
		reference: { kind: 'text' },
		business_on: { kind: 'date' },
		supplier_code: { kind: 'text', optional: true },
		supplier_name: { kind: 'text', optional: true },
		product_code: { kind: 'text' },
		product_name: { kind: 'text', optional: true },
		lot_number: { kind: 'text', optional: true },
		warehouse_code: { kind: 'text', optional: true },
		unit: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3 },
		currency: { kind: 'currency' },
		net_amount: { kind: 'money', currency: 'currency', optional: true },
		tax_amount: { kind: 'money', currency: 'currency', optional: true },
		// a receipt line's purchase order number
		order_reference: { kind: 'text', optional: true },
		// the line it was made from: a receipt's order line, an invoice's receipt line (`<kind>:<id>:<entry>`)
		upstream: { kind: 'text', optional: true },
		// an invoice's payable: its amount, what remains open, when it falls due and was last paid
		billed_amount: { kind: 'money', currency: 'currency', optional: true },
		open_amount: { kind: 'money', currency: 'currency', optional: true },
		due_on: { kind: 'date', optional: true },
		paid_on: { kind: 'date', optional: true },
		active: { kind: 'bool', default: true },
		source_updated_at: { kind: 'instant' },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' } },
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: {
		search: {
			text: ['reference', 'supplier_name', 'product_name', 'lot_number', 'order_reference']
		}
	},
	create: { fields: written },
	update: { fields: written }
});
