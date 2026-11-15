import { automation } from '@norbital-ai/bolt';
import { addDays } from '../lib/calculations.js';
import { FACILITY_FIELDS, LINE_FIELDS, utilisation } from '../lib/treasury.js';
import { Effect } from 'effect';

type DrawdownWhere = import('@norbital-ai/bolt').Where<'drawdown'>;

/**
 * The Alerts page, run every morning: lines due within 7 days, banks at 80% or more, facility reviews within 60
 * days, earmarks past their date, past-due lines without a settlement advice, LC and DA bills to decide within 14
 * days, LCs expiring within 14 days, lines due after the latest date their bank finances to, and LCs to open. One
 * notice to Treasury when there is anything to say.
 */
export default automation({
	description: 'Every morning, tells Treasury what needs attention on the Alerts page.',
	on: [{ cron: '0 8 * * *' }],
	policies: ['treasury'],
	run: function* (_input, ctx) {
		const today = ctx.today;
		const open = ['applied', 'active'] as const;
		const lines = (where: DrawdownWhere) =>
			ctx
				.query({ drawdown: { where, aggregate: { count: true } } })
				.pipe(Effect.map((r) => r.drawdown.count));
		const counts = {
			due: yield* lines({ status: { in: open }, due_date: { gte: today, lte: addDays(today, 7) } }),
			past_due: yield* lines({ status: { in: open }, due_date: { lt: today } }),
			stale: yield* lines({ status: { eq: 'earmarked' }, expected_draw_date: { lt: today } }),
			bills: yield* lines({
				status: { in: open },
				product: { in: ['lc', 'import_bill', 'da', 'tb'] },
				due_date: { lte: addDays(today, 14) }
			}),
			lc_expiry: yield* lines({
				status: { in: open },
				product: { eq: 'lc' },
				lc_expiry_date: { lte: addDays(today, 14) }
			}),
			reviews: (yield* ctx.query({
				facility: {
					where: { status: { eq: 'active' }, review_date: { lte: addDays(today, 60) } },
					aggregate: { count: true }
				}
			})).facility.count,
			lcs_to_open: (yield* ctx.query({
				purchase_order: {
					where: { lc_requested: { eq: true }, is_cancelled: { eq: false }, lc_links: { eq: 0 } },
					aggregate: { count: true }
				}
			})).purchase_order.count,
			high: 0
		};
		const usage = yield* ctx.query({
			facility: {
				fields: [...FACILITY_FIELDS],
				bank: { fields: ['code'] }
			},
			drawdown: { where: { status: { in: ['earmarked', ...open] } }, fields: [...LINE_FIELDS] }
		});
		counts.high = utilisation(usage.facility.rows, usage.drawdown.rows).banks.filter(
			(b) => b.high
		).length;
		if (Object.values(counts).every((n) => n === 0)) return;
		yield* ctx.notify({
			title: `Treasury: ${counts.due} due within 7 days, ${counts.past_due} past due, ${counts.high} bank(s) at 80%+, ${counts.reviews} review(s), ${counts.stale} stale earmark(s), ${counts.bills} bill(s) to decide, ${counts.lc_expiry} LC(s) expiring, ${counts.lcs_to_open} LC(s) to open`,
			to: [{ team: 'treasury' }],
			once: `alerts:${today}`
		});
	}
});
