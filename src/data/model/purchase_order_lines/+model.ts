import { model } from '@norbital-ai/bolt';

/** `received` sums the goods receipts against the line; a receipt never takes it past the ordered quantity. */
export default model({
	description:
		'Line items on a purchase order. Snapshots the product code, name, and unit at creation and computes amounts in the order’s own tax mode and currency. The unit cost is a buy-side fact entered by the purchaser — it is never derived from the sales catalogue, and the cost column carries it only here, where sales has no grant.',
	icon: 'lucide:list-checks',
	label: ['product_name', 'quantity'],
	fields: {
		product_code: { kind: 'text' },
		product_name: { kind: 'text' },
		product_unit: { kind: 'text', optional: true },
		quantity: { kind: 'decimal', scale: 3 },
		unit_cost: { kind: 'decimal', scale: 4 },
		tax_rate: { kind: 'decimal', scale: 2, default: 0 },
		net: { kind: 'decimal', scale: 2 },
		tax: { kind: 'decimal', scale: 2 },
		line_total: { kind: 'decimal', scale: 2 },
		received: { kind: 'sum', of: 'goods_receipt_lines.quantity_received' }
	},
	check: { received_within_ordered: { received: { lte: { field: 'quantity' } } } },
	search: { text: ['product_name'] }
});
