import { automation, type AutomationCtx, type Id } from '@norbital-ai/bolt';
import { monthStart } from '../lib/calculations.js';
import { FACILITY_FIELDS, MONTH_END_LINE_FIELDS, monthEndFrom } from '../lib/treasury.js';
/** Calculate every source page and freeze its detail and totals in one native write. */
export default automation({
	description: 'Close a month with a calculated, frozen snapshot.',
	input: { month: { kind: 'date' } },
	policies: ['month_end_closing'],
	run: function* (input, ctx) {
		const month = monthStart(input.month);
		const existing = (yield* ctx.query({
			month_end: {
				where: { month: { eq: month } },
				fields: ['revision', 'source', 'is_locked'],
				limit: 1
			}
		})).month_end.rows[0];
		if (existing?.source === 'excel') return yield* ctx.refuse('errors.month_imported');
		if (existing?.is_locked) return yield* ctx.refuse('errors.month_locked');
		const book = yield* closingBook(ctx, existing === undefined ? [] : [existing.id]);
		const report = monthEndFrom(month, book.drawdown.rows, book.facility.rows, book.fx_rate.rows);
		const set = { ...report.figures, is_locked: true, locked_at: ctx.now };
		if (existing === undefined)
			yield* ctx.act({ 'month_end.create': [{ month, ...set, lines: report.lines }] });
		else
			yield* ctx.act({
				'month_end.update': [
					{
						target: existing,
						set: { ...set, lines: { delete: book.month_end_line.rows, create: report.lines } }
					}
				]
			});
	}
});
function* closingBook(ctx: AutomationCtx, ids: readonly Id<'month_end'>[]) {
	const drawdowns = {
		where: { status: { in: ['applied', 'active', 'settled'] } },
		fields: [...MONTH_END_LINE_FIELDS],
		limit: 500,
		supplier: { fields: ['name'] },
		charges: { fields: ['amount', 'fx_rate_to_usd', 'stage'] }
	} as const;
	const facilities = {
		limit: 500,
		fields: [...FACILITY_FIELDS],
		bank: { fields: ['code'] }
	} as const;
	const rates = { limit: 500, fields: ['currency', 'rate_date', 'usd_per_unit'] } as const;
	const oldLines = {
		where: { month_end: { in: ids } },
		limit: 500,
		fields: ['revision', 'month_end']
	} as const;
	const first = yield* ctx.query({
		drawdown: drawdowns,
		facility: facilities,
		fx_rate: rates,
		month_end_line: oldLines
	});
	const lines = [...first.drawdown.rows],
		limits = [...first.facility.rows],
		fx = [...first.fx_rate.rows],
		previous = [...first.month_end_line.rows];
	let d = first.drawdown.next,
		f = first.facility.next,
		x = first.fx_rate.next,
		l = first.month_end_line.next;
	// Closing must read the whole book, never freeze a truncated page. Native run budgets fail the write atomically.
	while (d !== null || f !== null || x !== null || l !== null) {
		const page = yield* ctx.query({
			drawdown: { ...drawdowns, ...(d === null ? { where: { id: { in: [] } } } : { after: d }) },
			facility: { ...facilities, ...(f === null ? { where: { id: { in: [] } } } : { after: f }) },
			fx_rate: { ...rates, ...(x === null ? { where: { id: { in: [] } } } : { after: x }) },
			month_end_line: {
				...oldLines,
				...(l === null ? { where: { id: { in: [] } } } : { after: l })
			}
		});
		lines.push(...page.drawdown.rows);
		limits.push(...page.facility.rows);
		fx.push(...page.fx_rate.rows);
		previous.push(...page.month_end_line.rows);
		d = page.drawdown.next;
		f = page.facility.next;
		x = page.fx_rate.next;
		l = page.month_end_line.next;
	}
	return {
		...first,
		drawdown: { ...first.drawdown, rows: lines },
		facility: { ...first.facility, rows: limits },
		fx_rate: { ...first.fx_rate, rows: fx },
		month_end_line: { ...first.month_end_line, rows: previous }
	};
}
