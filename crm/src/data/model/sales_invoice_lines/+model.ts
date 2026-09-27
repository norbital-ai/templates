import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One billed quantity against one quote line. Snapshots the product and price from the quote line at creation; cumulative allocated quantity per quote line is capped at the quoted quantity across live invoices.',
	icon: 'lucide:list-checks',
	label: ['product_name', 'quantity'],
	fields: {
		product_code: { kind: 'text' },
		product_name: { kind: 'text' },
		product_unit: { kind: 'text', optional: true },
		quantity: { kind: 'decimal', scale: 3 },
		unit_price: { kind: 'decimal', scale: 4 },
		tax_rate: { kind: 'decimal', scale: 2, default: 0 },
		net: { kind: 'decimal', scale: 2 },
		tax: { kind: 'decimal', scale: 2 },
		line_total: { kind: 'decimal', scale: 2 }
	},
	search: { text: ['product_name'] }
});
