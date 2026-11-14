import { model } from '@norbital-ai/bolt';
/**
 * The rate used to put a foreign-currency line into USD, including the month-end rate.
 */
export default model('fx_rate', {
	description: 'How many USD one unit of a currency buys, on a date.',
	icon: 'lucide:arrow-left-right',
	record_label: 'record.currency',
	fields: {
		currency: { kind: 'currency' },
		rate_date: { kind: 'date' },
		usd_per_unit: { kind: 'decimal', scale: 12 },
		is_month_end: { kind: 'bool', default: false },
		source: { kind: 'text', optional: true }
	},
	constraints: {
		fx_per_day: { unique: ['currency', 'rate_date'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: ['currency', 'rate_date', 'usd_per_unit', 'is_month_end', 'source'] },
	update: { fields: ['currency', 'rate_date', 'usd_per_unit', 'is_month_end', 'source'] }
});
