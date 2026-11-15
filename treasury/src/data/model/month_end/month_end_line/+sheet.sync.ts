import { sync } from '@norbital-ai/bolt';
import { monthStart } from '../../../../lib/calculations.js';
import { FACILITY_FIELDS, MONTH_END_LINE_FIELDS, monthEndFrom } from '../../../../lib/treasury.js';

/**
 * The month-end export: a locked month's copied lines, or for a month not locked the live figures, one row per line
 * open at the month-end. Export only; the page passes the month.
 */
export default sync('month_end_line', 'sheet', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	context: { month: { kind: 'date' } },
	schema: {
		bank: { kind: 'text' },
		product: { kind: 'text', optional: true },
		reference: { kind: 'text', optional: true },
		supplier: { kind: 'text', optional: true },
		currency: { kind: 'text' },
		amount: { kind: 'decimal', scale: 2 },
		fx_rate_to_usd: { kind: 'decimal', scale: 12 },
		amount_usd: { kind: 'decimal', scale: 2, optional: true },
		rate_pct: { kind: 'decimal', scale: 6, optional: true },
		start_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		tenor_days: { kind: 'int', optional: true },
		accrued_days: { kind: 'int', optional: true },
		accrued_interest: { kind: 'decimal', scale: 2, optional: true },
		interest_to_maturity: { kind: 'decimal', scale: 2, optional: true },
		charges_usd: { kind: 'decimal', scale: 2, optional: true }
	},
	write: function* ({ context }, ctx) {
		const month = monthStart(context.month);
		const { month_end } = yield* ctx.query({
			month_end: {
				where: { month: { eq: month }, is_locked: { eq: true } },
				fields: ['month'],
				lines: {
					fields: [
						'bank_code',
						'product',
						'reference',
						'supplier',
						'currency',
						'amount',
						'fx_rate_to_usd',
						'amount_usd',
						'interest_rate_pct',
						'start_date',
						'due_date',
						'tenor_days',
						'accrued_days',
						'accrued_interest',
						'interest_to_maturity',
						'charges'
					]
				},
				limit: 1
			}
		});
		const locked = month_end.rows[0];
		if (locked !== undefined) return locked.lines.map(row);
		const { drawdown, facility, fx_rate } = yield* ctx.query({
			drawdown: {
				where: { status: { in: ['applied', 'active', 'settled'] } },
				fields: [...MONTH_END_LINE_FIELDS],
				supplier: { fields: ['name'] },
				charges: { fields: ['amount', 'currency'] }
			},
			facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
			fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] }
		});
		return monthEndFrom(month, drawdown.rows, facility.rows, fx_rate.rows).lines.map(row);
	}
});

/** One exported row. */
const row = (l: {
	readonly bank_code: string;
	readonly product: string | null;
	readonly reference: string | null;
	readonly supplier: string | null;
	readonly currency: string;
	readonly amount: string;
	readonly fx_rate_to_usd: string;
	readonly amount_usd: string | null;
	readonly interest_rate_pct: string | null;
	readonly start_date: string | null;
	readonly due_date: string | null;
	readonly tenor_days: number | null;
	readonly accrued_days: number | null;
	readonly accrued_interest: string | null;
	readonly interest_to_maturity: string | null;
	readonly charges: string | null;
}) => ({
	bank: l.bank_code,
	product: l.product,
	reference: l.reference,
	supplier: l.supplier,
	currency: l.currency,
	amount: l.amount,
	fx_rate_to_usd: l.fx_rate_to_usd,
	amount_usd: l.amount_usd,
	rate_pct: l.interest_rate_pct,
	start_date: l.start_date,
	due_date: l.due_date,
	tenor_days: l.tenor_days,
	accrued_days: l.accrued_days,
	accrued_interest: l.accrued_interest,
	interest_to_maturity: l.interest_to_maturity,
	charges_usd: l.charges
});
