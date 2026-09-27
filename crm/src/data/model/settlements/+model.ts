import { model } from '@norbital-ai/bolt';
import { CURRENCIES } from '../../../lib/currency.js';

/**
 * Against exactly one committed document: a quote, a purchase order or a purchase invoice (`regarding`, an exclusive
 * arc).
 */
export default model({
	description:
		'A payment or settlement received (from a customer) or made (to a supplier) against a committed document. The paid / partial / unpaid status of a document is never stored: it is derived at render from the sum of its settlements against its gross, and only for committed documents — anything else shows an em-dash.',
	icon: 'lucide:banknote',
	label: 'reference',
	fields: {
		amount: { kind: 'decimal', scale: 2 },
		currency: { kind: 'enum', values: CURRENCIES, optional: true },
		settled_on: { kind: 'date', optional: true },
		reference: { kind: 'text', optional: true }
	},
	check: {
		positive: { amount: { gt: 0 } }
	},
	search: { text: ['reference'] }
});
