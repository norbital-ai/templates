import { automation } from '@norbital-ai/bolt';
import { DAILY_0600, digestOutput } from '../lib/digest.js';

const a = automation({
	description:
		'Sweeps the active and expiring permits to work every morning at 6am and publishes the first 25 as a JSON extract so permits nearing the end of their validity range are caught before crews are stood down.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput
});
export default a;

a.run(async (_, ctx) => {
	const { rows } = await ctx.read('permits_to_work', {
		where: { status: { in: ['active', 'expiring_soon'] } },
		orderBy: { requested_date: 'asc' },
		limit: 25
	});
	// rows are typed values (instants, dates, decimals) that serialize as JSON; `json` does not admit their types
	return { generated_at: ctx.now, count: rows.length, rows: rows as never };
});
