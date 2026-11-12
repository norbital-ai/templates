import { model } from '../../../../.norbital/models/report.ts';

const columns = [
	'for_date',
	'base_currency',
	'headline',
	'summary',
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
	'deliveries'
] as const;

/**
 * One day's report: the book's totals, its allocation and the rates they were struck at, the
 * market view and one call per holding. The daily agent writes it and sends it; people read it.
 */
export default model({
	description:
		'The daily report: the totals computed from the book and the market, and one call per holding.',
	icon: 'lucide:newspaper',
	record_label: 'string(record.for_date)',
	fields: {
		for_date: { kind: 'date' },
		base_currency: { kind: 'currency' },
		headline: { kind: 'text' },
		summary: { kind: 'text' },
		market_view: { kind: 'text', optional: true },
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
				pnl: { kind: 'decimal', scale: 2, optional: true },
				pnl_pct: { kind: 'decimal', scale: 2, optional: true },
				analysis: { kind: 'text' },
				confidence: { kind: 'decimal', scale: 2, optional: true }
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
