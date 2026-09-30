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
		currency: { kind: 'currency' },
		unit_cost: { kind: 'money', currency: 'currency', scale: 4 },
		tax_rate: { kind: 'decimal', scale: 2, default: 0 },
		net: { kind: 'money', currency: 'currency' },
		tax: { kind: 'money', currency: 'currency' },
		line_total: { kind: 'money', currency: 'currency' }
	},
	search: { text: ['product_name'] }
});
