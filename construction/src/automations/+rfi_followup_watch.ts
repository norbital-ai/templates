import { Clock, Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';

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
			'Sweeps the RFI register every morning at 6am and publishes the first 25 as a JSON extract so queries still waiting on the design team can be chased.',
		handler: (api) =>
			Effect.gen(function* () {
				const rfis = yield* api.db.query.rfis.findMany({
					where: { status: { eq: 'open' } },
					orderBy: { due_date: 'asc' },
					limit: 25
				});
				const generatedAt = yield* Clock.currentTimeMillis;
				return {
					automation_key: 'rfi_followup_watch',
					generated_at: new Date(generatedAt).toISOString(),
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
