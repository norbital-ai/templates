import { model } from '@norbital-ai/bolt';
import { PRODUCT_CODES } from '../../../../lib/products.js';
/**
 * One line as it stood at a locked month-end, copied so later edits never change a closed month.
 */
export default model('month_end_line', {
	description: 'One line as it stood at a locked month-end.',
	icon: 'lucide:list',
	record_label: "record.bank_code + ' · ' + (record.reference != null ? record.reference : '—')",
	fields: {
		month_end: { kind: 'ref', to: 'month_end', inverse: 'lines', on_delete: 'cascade' },
		drawdown: {
			kind: 'ref',
			to: 'drawdown',
			inverse: 'month_end_lines',
			optional: true,
			on_delete: 'set_null'
		},
		bank_code: { kind: 'text' },
		product: { kind: 'enum', values: PRODUCT_CODES, optional: true },
		reference: { kind: 'text', optional: true },
		supplier: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2 },
		fx_rate_to_usd: { kind: 'decimal', scale: 12, default: 1 },
		amount_usd: { kind: 'decimal', scale: 2, optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		day_count_basis: {
			kind: 'enum',
			values: ['actual_360', 'actual_365'],
			default: 'actual_360'
		},
		start_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		tenor_days: { kind: 'int', optional: true },
		accrued_days: { kind: 'int', optional: true },
		accrued_interest: { kind: 'decimal', scale: 2, optional: true },
		interest_to_maturity: { kind: 'decimal', scale: 2, optional: true },
		charges: { kind: 'decimal', scale: 2, optional: true }
	},
	outputs: {
		default: { fields: 'all', month_end: { fields: ['month'] } }
	}
});
