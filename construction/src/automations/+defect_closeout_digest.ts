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
			'Counts the defect register every morning at 6am and publishes the first 25 defects as a JSON extract for the closeout meeting.',
		handler: (api) =>
			Effect.gen(function* () {
				const defects = yield* api.db.defects.findMany({
					where: { status: { in: ['open', 'in_review', 'ready_for_closeout'] } },
					orderBy: { due_date: 'asc' },
					limit: 25
				});
				const generatedAt = yield* currentInstantIso;
				return {
					automation_key: 'defect_closeout_digest',
					generated_at: generatedAt,
					summary: { defect_count: defects.length },
					exports: [
						{
							filename: 'defect-closeout-digest.json',
							content_type: 'application/json',
							rows: defects
						}
					]
				};
			})
	}
);
