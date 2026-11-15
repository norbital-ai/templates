import { automation } from '@norbital-ai/bolt';
import { monthStart } from '../lib/calculations.js';
import { FACILITY_FIELDS, MONTH_END_LINE_FIELDS, monthEndFrom } from '../lib/treasury.js';

/**
 * Freezes a month: every line owed at its close, revalued at the month-end rate, with accrued interest, interest to
 * maturity and charges, and the headline figures, are copied into the month's report, which is then locked so later
 * edits never change it. Locking again after an unlock replaces the copy.
 */
export default automation({
	description: 'Lock a month-end: copy its lines and figures so later edits never change them.',
	input: { month: { kind: 'date' } },
	policies: ['treasury'],
	run: function* (input, ctx) {
		const month = monthStart(input.month);
		const { drawdown, facility, fx_rate, month_end } = yield* ctx.query({
			drawdown: {
				where: { status: { in: ['applied', 'active', 'settled'] } },
				fields: [...MONTH_END_LINE_FIELDS],
				supplier: { fields: ['name'] },
				charges: { fields: ['amount', 'currency'] }
			},
			facility: {
				fields: [...FACILITY_FIELDS],
				bank: { fields: ['code'] }
			},
			fx_rate: { fields: ['currency', 'rate_date', 'usd_per_unit'] },
			month_end: {
				where: { month: { eq: month } },
				fields: ['is_locked', 'revision'],
				lines: { fields: ['revision'] }
			}
		});
		const existing = month_end.rows[0];
		if (existing?.is_locked === true) return yield* ctx.refuse('errors.month_locked');
		const report = monthEndFrom(month, drawdown.rows, facility.rows, fx_rate.rows);
		const set = {
			...report.figures,
			is_locked: true,
			locked_at: ctx.now,
			source: 'portal' as const
		};
		if (existing === undefined)
			yield* ctx.act({ 'month_end.create': [{ month, ...set, lines: report.lines }] });
		else
			yield* ctx.act({
				'month_end.update': [
					{
						target: existing,
						set: { ...set, lines: { delete: existing.lines, create: report.lines } }
					}
				]
			});
	}
});
