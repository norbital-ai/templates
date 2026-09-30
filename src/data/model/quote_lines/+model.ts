import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Line items on a quote. Snapshots product code, name, unit, and price at creation, and computes net, tax, and total from the parent document’s tax mode.',
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
