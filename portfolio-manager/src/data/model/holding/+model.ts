import { model } from '../../../../.norbital/models/holding.ts';

/** Every field is written: the statement's by people, the calculated ones by the daily agent. */
const columns = [
	'instrument',
	'symbol',
	'isin',
	'asset_class',
	'currency',
	'quantity',
	'cost_value',
	'market_value',
	'value_base',
	'unrealised_pl',
	'risk_rating',
	'price_date',
	'detail',
	'documents',
	'sources',
	'research_direction',
	'live_price',
	'live_value_base',
	'live_change_pct',
	'price_updated_at',
	'volume_ratio',
	'movement',
	'pnl_history',
	'research_summary',
	'research_at',
	'insights'
] as const;

/**
 * One line of the book: a security, a cash balance or a facility. The research on the line lives
 * here too: the direction the agent should follow, and the insights with the references behind them.
 */
export default model({
	description: 'A line of the book (security, cash or facility) with the research kept on it.',
	icon: 'lucide:trending-up',
	record_label: 'record.instrument',
	fields: {
		instrument: { kind: 'text' },
		symbol: {
			kind: 'text',
			optional: true
		},
		isin: { kind: 'text', optional: true },
		asset_class: {
			kind: 'enum',
			values: ['equity', 'structured', 'fund', 'bond', 'metal', 'cash', 'loan', 'other'],
			default: 'equity'
		},
		currency: { kind: 'currency' },
		quantity: { kind: 'decimal', scale: 4, default: 1 },
		cost_value: { kind: 'decimal', scale: 2, optional: true },
		market_value: { kind: 'decimal', scale: 2, default: 0 },
		value_base: { kind: 'decimal', scale: 2 },
		unrealised_pl: { kind: 'decimal', scale: 2, optional: true },
		risk_rating: { kind: 'int', optional: true, min: 1, max: 5 },
		price_date: { kind: 'date', optional: true },
		detail: { kind: 'text', optional: true },
		documents: {
			kind: 'file',
			accept: ['application/pdf', 'image/png', 'image/jpeg', 'text/csv'],
			max: '32MiB',
			many: true,
			optional: true
		},
		sources: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'url',
			fields: { label: { kind: 'text' }, url: { kind: 'text' } }
		},
		research_direction: {
			kind: 'text',
			optional: true
		},
		live_price: { kind: 'decimal', scale: 4, optional: true },
		live_value_base: { kind: 'decimal', scale: 2, optional: true },
		live_change_pct: { kind: 'decimal', scale: 2, optional: true },
		price_updated_at: { kind: 'instant', optional: true },
		volume_ratio: {
			kind: 'decimal',
			scale: 2,
			optional: true
		},
		movement: {
			kind: 'enum',
			values: ['surge', 'active', 'normal', 'quiet'],
			optional: true
		},
		pnl_history: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'date',
			fields: {
				date: { kind: 'date' },
				pnl: { kind: 'decimal', scale: 2 },
				pnl_pct: { kind: 'decimal', scale: 2, optional: true }
			}
		},
		research_summary: { kind: 'text', format: 'markdown', optional: true },
		research_at: { kind: 'instant', optional: true },
		insights: {
			kind: 'object',
			many: true,
			optional: true,
			key: 'url',
			fields: {
				headline: { kind: 'text' },
				source_name: { kind: 'text', optional: true },
				url: { kind: 'text' }
			}
		}
	},
	constraints: {
		/** A facility is owed: its base value is never positive, so the metrics add up without a model of its own. */
		loan_is_owed: {
			check: { or: [{ asset_class: { ne: 'loan' } }, { value_base: { lte: '0' } }] },
			message: 'errors.loan_is_owed'
		}
	},
	indexes: {
		find: { text: ['instrument', 'symbol', 'detail', 'research_direction', 'research_summary'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } },
	delete: {}
});
