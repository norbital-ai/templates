import { Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';

export default defineAutomation(
	{ schedule: '0 6 * * *' },
	{
		description:
			'Sweeps the permits to work every morning at 6am and publishes the first 25 as a JSON extract so permits nearing the end of their validity range are caught before crews are stood down.',
		handler: (api) =>
			Effect.gen(function* () {
				const permits = yield* api.db.query.permits_to_work.findMany({
					where: { status: { in: ['active', 'expiring_soon'] } },
					orderBy: { requested_date: 'asc' },
					limit: 25
				});
				return {
					automation_key: 'permit_expiry_watch',
					generated_at: new Date().toISOString(),
					summary: { permit_count: permits.length },
					exports: [
						{
							filename: 'permit-expiry-watch.json',
							content_type: 'application/json',
							rows: permits
						}
					]
				};
			})
	}
);
