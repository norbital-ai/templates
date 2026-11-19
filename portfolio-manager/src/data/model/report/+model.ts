import { model } from '@norbital-ai/bolt';

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
	'exposure',
	'fx_used',
	'positions',
	'sources'
] as const;

/**
 * One day's report, written to be read in a minute: the lead, what is in it, the markets table with the data line and
 * the move, and one section per line with cited news. Every claim links its source; `sources` keeps them. The book's
 * totals, allocation and rates stay on the record. The daily agent sends its record view, rendered to PDF, to every
 * subscriber through the envoy's accounts.
 */
export default model('report', {
	description:
		'The daily report: the totals computed from the book and the market, and one call per holding.',
	icon: 'lucide:newspaper',
	record_label: "'Portfolio report · ' + string(record.for_date)",
	fields: {
		for_date: { kind: 'date' },
		base_currency: { kind: 'currency' },
		/** The lead: one sentence, the most important thing today, with its source linked. */
		headline: { kind: 'text', format: 'markdown' },
		/** In today's report: two to four bullets. */
		summary: { kind: 'text', format: 'markdown' },
		/**
		 * The benchmarks and every quoted line of the book: price, the move over a day, a week, a month and a year, the
		 * trend, and whether buyers or sellers lead.
		 */
		markets: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'instrument',
			fields: {
				instrument: { kind: 'text' },
				level: { kind: 'decimal', scale: 2 },
				change_pct: { kind: 'decimal', scale: 2, optional: true },
				change_1w_pct: { kind: 'decimal', scale: 2, optional: true },
				change_1m_pct: { kind: 'decimal', scale: 2, optional: true },
				change_1y_pct: { kind: 'decimal', scale: 2, optional: true },
				trend: { kind: 'enum', values: ['up', 'sideways', 'down'], optional: true },
				pressure: { kind: 'enum', values: ['buying', 'balanced', 'selling'], optional: true }
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
		/** The book by currency, in base, weighed against total assets: what a move in each rate touches. */
		exposure: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'currency',
			fields: {
				currency: { kind: 'text' },
				value: { kind: 'decimal', scale: 2 },
				weight: { kind: 'decimal', scale: 2 }
			}
		},
		/** Every rate the run valued a line or a quote at: base per unit of the currency. */
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
		}
	},
	constraints: { one_per_day: { unique: ['for_date'], message: 'errors.report_exists' } },
	indexes: { find: { text: ['headline', 'summary', 'market_view'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns },
	delete: {}
});
