import { model } from '../../../../.norbital/models/report.ts';

const columns = [
	'for_date',
	'base_currency',
	'headline',
	'summary',
	'markets',
	'market_view',
	'research_log',
	'net_assets',
	'invested',
	'cash',
	'liabilities',
	'unrealised_pl',
	'day_change',
	'allocation',
	'fx_used',
	'positions',
	'sources',
	'deliveries'
] as const;

/**
 * One day's report, written to be read in a minute: the lead, what is in it, the markets table with the data line and
 * the move, and one section per line with cited news. Every claim links its source; `sources` keeps them. The book's
 * totals, allocation and rates stay on the record. The daily agent sends its record view, rendered to PDF, to the
 * subscribed users and the chats in the settings.
 */
export default model({
	description:
		'The daily report: the totals computed from the book and the market, and one call per holding.',
	icon: 'lucide:newspaper',
	record_label: 'string(record.for_date)',
	fields: {
		for_date: { kind: 'date' },
		base_currency: { kind: 'currency' },
		/** The lead: one sentence, the most important thing today, with its source linked. */
		headline: { kind: 'text', format: 'markdown' },
		/** In today's report: two to four bullets. */
		summary: { kind: 'text', format: 'markdown' },
		/** Every line of the book and the benchmarks: its price where quoted, else its value in base. */
		markets: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'instrument',
			fields: {
				instrument: { kind: 'text' },
				level: { kind: 'decimal', scale: 2 },
				change_pct: { kind: 'decimal', scale: 2, optional: true }
			}
		},
		/** The data line (as of, providers) and one cited paragraph on the move. */
		market_view: { kind: 'text', format: 'markdown', optional: true },
		research_log: {
			kind: 'text',
			optional: true
		},
		net_assets: { kind: 'decimal', scale: 2 },
		invested: { kind: 'decimal', scale: 2 },
		cash: { kind: 'decimal', scale: 2 },
		liabilities: { kind: 'decimal', scale: 2 },
		unrealised_pl: { kind: 'decimal', scale: 2, optional: true },
		day_change: { kind: 'decimal', scale: 2, optional: true },
		allocation: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'label',
			fields: {
				label: { kind: 'text' },
				value: { kind: 'decimal', scale: 2 },
				weight: { kind: 'decimal', scale: 2 }
			}
		},
		fx_used: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'pair',
			fields: { pair: { kind: 'text' }, rate: { kind: 'decimal', scale: 6 } }
		},
		positions: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'instrument',
			fields: {
				instrument: { kind: 'text' },
				symbol: { kind: 'text', optional: true },
				weight: { kind: 'decimal', scale: 2, optional: true },
				change_pct: { kind: 'decimal', scale: 2, optional: true },
				call: { kind: 'enum', values: ['buy', 'sell', 'hold', 'watch'] },
				headline: { kind: 'text' },
				pnl: { kind: 'decimal', scale: 2, optional: true },
				pnl_pct: { kind: 'decimal', scale: 2, optional: true },
				/** What happened, why it matters for the book, the call: each paragraph cites its sources inline. */
				analysis: { kind: 'text', format: 'markdown' },
				confidence: { kind: 'decimal', scale: 2, optional: true }
			}
		},
		/** Every source the report cites, as read on the run. */
		sources: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'url',
			fields: {
				title: { kind: 'text' },
				publisher: { kind: 'text' },
				url: { kind: 'text', format: 'url' },
				at: { kind: 'instant' }
			}
		},
		/** The messages the report went out as: queue admission; each message's own status says whether it arrived. */
		deliveries: { kind: 'ref', to: 'sys_message', many: true, optional: true }
	},
	constraints: { one_per_day: { unique: ['for_date'], message: 'errors.report_exists' } },
	indexes: { find: { text: ['headline', 'summary', 'market_view'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } },
	delete: {}
});
