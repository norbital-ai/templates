import { model } from '@norbital-ai/bolt';

/**
 * The workspace's portfolio configuration, one row: the currency the book is valued in, and who receives the daily
 * report through which paired account. A workspace in another currency or with other recipients changes this row,
 * never the source.
 */
export default model('portfolio_settings', {
	description:
		'The base currency, the benchmarks, and the paired account and chats the daily report is sent to.',
	icon: 'lucide:settings',
	record_label: "'Portfolio settings'",
	fields: {
		base_currency: { kind: 'currency' },
		report_via: { kind: 'ref', to: 'sys_integration', optional: true },
		recipients: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'handle',
			fields: { name: { kind: 'text', optional: true }, handle: { kind: 'text' } }
		},
		/** The indices the markets table leads with, by quote symbol ("^GSPC", "^STI"). */
		benchmarks: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'symbol',
			fields: { name: { kind: 'text', optional: true }, symbol: { kind: 'text' } }
		}
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: ['base_currency', 'report_via', 'recipients', 'benchmarks'] },
	update: { fields: ['base_currency', 'report_via', 'recipients', 'benchmarks'] },
	delete: {}
});
