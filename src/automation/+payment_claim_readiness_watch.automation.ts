import { automation } from '@norbital-ai/bolt';
import { DAILY_0600, digestOutput } from '../lib/digest.js';

const a = automation({
	description:
		'Counts the draft and submitted payment claims every morning at 6am and publishes the 25 most recently changed as a JSON extract so the commercial team can check progress-claim readiness.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput
});
export default a;

a.run(async (_, ctx) => {
	const { rows } = await ctx.read('payment_claims', {
		where: { status: { in: ['draft', 'submitted'] } },
		orderBy: { updated_at: 'desc' },
		limit: 25
	});
	// rows are typed values (instants, dates, decimals) that serialize as JSON; `json` does not admit their types
	return { generated_at: ctx.now, count: rows.length, rows: rows as never };
});
