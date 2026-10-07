import { automation } from '@norbital-ai/bolt';
import { DAILY_0600, digestOutput, jsonRows } from '../lib/digest.js';

const a = automation({
	description:
		'Sweeps the open RFIs every morning at 6am and publishes the first 25 by due date as a JSON extract so queries still waiting on the design team can be chased.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput
});
export default a;

a.run(async (_, ctx) => {
	const { rows } = await ctx.read('rfis', {
		where: { status: { eq: 'open' } },
		orderBy: { due_date: 'asc' },
		limit: 25
	});
	return { generated_at: ctx.now, count: rows.length, rows: jsonRows(rows) };
});
