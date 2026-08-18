import { Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';

export default defineAutomation(
	{ schedule: '0 6 * * *' },
	{
		description:
			'Sweeps the RFI register every morning at 6am and publishes the first 25 as a JSON extract so queries still waiting on the design team can be chased.',
		handler: (api) =>
			Effect.gen(function* () {
				const rfis = yield* api.db.query.rfis.findMany({
					where: { status: { eq: 'open' } },
					orderBy: { due_date: 'asc' },
					limit: 25
				});
				return {
					automation_key: 'rfi_followup_watch',
					generated_at: new Date().toISOString(),
					summary: { rfi_count: rfis.length },
					exports: [
						{
							filename: 'rfi-followup-watch.json',
							content_type: 'application/json',
							rows: rfis
						}
					]
				};
			})
	}
);
