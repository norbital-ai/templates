import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Products and services in the catalogue. The table is the mirror of the external system of record: `external_code` is the system’s item code, and the import pipeline keeps the table in step with it. Quote and purchase lines snapshot code, name, unit, and tax rate from here at creation, so a later catalogue edit never rewrites a historical document. `unit_price` is in the product’s own `currency` (the workspace’s, SGD, unless the feed says otherwise). `qty_on_hand` is the indicative stock mirror; buy cost never lives here — it stays on purchase lines, which sales has no grant to read.',
	icon: 'lucide:package',
	label: 'name',
	fields: {
		external_code: { kind: 'text' },
		code: { kind: 'text', unique: true },
		name: { kind: 'text' },
		description: { kind: 'text', optional: true },
		spec: { kind: 'text', optional: true },
		unit: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'SGD' },
		unit_price: { kind: 'money', currency: 'currency', scale: 4, optional: true },
		tax_rate: { kind: 'decimal', scale: 2, optional: true },
		qty_on_hand: { kind: 'decimal', scale: 3, optional: true },
		active: { kind: 'bool', default: true }
	},
	key: ['external_code'],
	search: { text: ['name'] }
});
