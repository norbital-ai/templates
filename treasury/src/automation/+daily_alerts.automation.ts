import { automation } from '@norbital-ai/bolt';
import { DateTime } from 'effect';

/**
 * The Alerts page, run every morning: lines that fall due in the next seven days, and
 * facility reviews due in the next sixty. One notice to the Treasury team when there is anything
 * to say.
 */
export default automation({
	description:
		'Every morning, tells Treasury which lines fall due in 7 days and which facilities are up for review.',
	on: [{ cron: '0 8 * * *' }],
	policies: ['treasury'],
	run: function* (input, ctx) {
		const today = DateTime.formatIsoDateUtc(DateTime.makeUnsafe(ctx.today));
		const week = DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.makeUnsafe(ctx.today), { days: 7 })
		);
		const quarter = DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.makeUnsafe(ctx.today), { days: 60 })
		);

		const lines = (yield* ctx.query({
			drawdown: {
				where: { status: { in: ['applied', 'active'] }, is_archived: { eq: false } },
				fields: ['bank_reference', 'currency', 'amount', 'due_date', 'status'],
				facility: { fields: ['name'] },
				supplier: { fields: ['name'] }
			}
		})).drawdown.rows;

		const due = lines.filter((line) => {
			const when = line.due_date === null ? '' : String(line.due_date);
			return when !== '' && when >= today && when <= week;
		});

		const facilities = (yield* ctx.query({
			facility: {
				where: { status: { eq: 'active' } },
				fields: ['name', 'review_date']
			}
		})).facility.rows;

		const reviews = facilities.filter((facility) => {
			const when = facility.review_date === null ? '' : String(facility.review_date);
			return when !== '' && when >= today && when <= quarter;
		});

		if (due.length === 0 && reviews.length === 0) return;

		yield* ctx.notify({
			title: `Treasury: ${due.length} line(s) due within 7 days, ${reviews.length} facility review(s) within 60 days`,
			to: [{ team: 'treasury' }]
		});
	}
});
