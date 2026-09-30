import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One billed quantity against one quote line. Snapshots the product, price and discount from the quote line at creation; cumulative allocated quantity per quote line is capped at the quoted quantity across live invoices.',
	icon: 'lucide:list-checks',
	label: ['product_name', 'quantity'],
	fields: {
		product_code: { kind: 'text' },
		product_name: { kind: 'text' },
		product_unit: { kind: 'text', optional: true },
		quantity: { kind: 'decimal', scale: 3 },
		currency: { kind: 'currency' },
		unit_price: { kind: 'money', currency: 'currency', scale: 4 },
		discount_pct: { kind: 'decimal', scale: 2, default: 0 },
		tax_rate: { kind: 'decimal', scale: 2, default: 0 },
		net: { kind: 'money', currency: 'currency' },
		tax: { kind: 'money', currency: 'currency' },
		line_total: { kind: 'money', currency: 'currency' }
	},
	search: { text: ['product_name'] }
});
