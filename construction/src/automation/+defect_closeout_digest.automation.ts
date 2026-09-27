import { automation } from '@norbital-ai/bolt';
import { DAILY_0600, digestOutput } from '../lib/digest.js';

const a = automation({
	description:
		'Counts the defect register every morning at 6am and publishes the first 25 open defects as a JSON extract for the closeout meeting.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput
});
export default a;

a.run(async (_, ctx) => {
	const { rows } = await ctx.read('defects', {
		where: { status: { in: ['open', 'in_review', 'ready_for_closeout'] } },
		orderBy: { due_date: 'asc' },
		limit: 25
	});
	// rows are typed values (instants, dates, decimals) that serialize as JSON; `json` does not admit their types
	return { generated_at: ctx.now, count: rows.length, rows: rows as never };
});
