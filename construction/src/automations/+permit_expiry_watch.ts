import { Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { currentInstantIso } from '../lib/clock.js';

export default defineAutomation(
	{ schedule: '0 6 * * *' },
	{
		/**
		 * The authority every run of this automation acts under.
		 *
		 * Its own, not its trigger's. This used to inherit whoever tripped it — so the same nightly
		 * sweep ran as an administrator when an administrator happened to start it, and as a contractor
		 * otherwise, over a different set of rows each time. Naming it here is what makes "what can this
		 * automation touch" a question with an answer that does not depend on the day.
		 */
		policies: ['construction_project_workspace'],
		description:
			'Sweeps the permits to work every morning at 6am and publishes the first 25 as a JSON extract so permits nearing the end of their validity range are caught before crews are stood down.',
		handler: (api) =>
			Effect.gen(function* () {
				const permits = yield* api.db.query.permits_to_work.findMany({
					where: { status: { in: ['active', 'expiring_soon'] } },
					orderBy: { requested_date: 'asc' },
					limit: 25
				});
				const generatedAt = yield* currentInstantIso;
				return {
					automation_key: 'permit_expiry_watch',
					generated_at: generatedAt,
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
