import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One invoiced quantity against one purchase order line. Snapshots the product and prices from the order line at creation; cumulative invoiced quantity per order line is capped at the ordered quantity across live invoices.',
	icon: 'lucide:list-checks',
	label: ['product_name', 'quantity'],
	fields: {
		product_code: { kind: 'text' },
		product_name: { kind: 'text' },
		quantity: { kind: 'decimal', scale: 3 },
		unit_cost: { kind: 'decimal', scale: 4 },
		tax_rate: { kind: 'decimal', scale: 2, default: 0 },
		net: { kind: 'decimal', scale: 2 },
		tax: { kind: 'decimal', scale: 2 },
		line_total: { kind: 'decimal', scale: 2 }
	},
	search: { text: ['product_name'] }
});
