import { model } from '@norbital-ai/bolt';
/**
 * How many USD one unit of a currency buys on a date: the official daily rate (fetched from the central bank
 * once a connection is set) or one Treasury keys in. Financing lines, month-ends and FX hedges all read it.
 */
export default model('fx_rate', {
	description: 'How many USD one unit of a currency buys, on a date.',
	icon: 'lucide:arrow-left-right',
	record_label: 'record.currency',
	fields: {
		currency: { kind: 'currency' },
		rate_date: { kind: 'date' },
		usd_per_unit: { kind: 'decimal', scale: 12 },
		/** Published as preliminary; the next fetch replaces it with the final rate. */
		preliminary: { kind: 'bool', default: false }
	},
	constraints: {
		fx_per_day: { unique: ['currency', 'rate_date'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: ['currency', 'rate_date', 'usd_per_unit', 'preliminary'] },
	update: { fields: ['currency', 'rate_date', 'usd_per_unit', 'preliminary'] }
});
