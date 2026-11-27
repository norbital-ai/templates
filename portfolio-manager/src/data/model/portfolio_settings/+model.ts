import { model } from '@norbital-ai/bolt';

/**
 * The workspace's portfolio configuration, one row: the currency the book is valued in and the benchmarks the markets
 * table leads with. A workspace in another currency changes this row, never the source.
 */
export default model('portfolio_settings', {
	description: 'The base currency and the benchmarks of the daily report.',
	icon: 'lucide:settings',
	record_label: "'Portfolio settings'",
	fields: {
		base_currency: { kind: 'currency' },
		/** The indices the markets table leads with, by quote symbol ("^GSPC", "^STI"). */
		benchmarks: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'symbol',
			fields: { name: { kind: 'text', optional: true }, symbol: { kind: 'text' } }
		},
		/** Optional explicit envoy channel used to deliver the daily report PDF to subscribers. */
		report_channel: {
			kind: 'ref',
			to: 'sys_integration',
			optional: true,
			on_delete: 'set_null'
		}
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: ['base_currency', 'benchmarks', 'report_channel'] },
	update: { fields: ['base_currency', 'benchmarks', 'report_channel'] },
	delete: {}
});
