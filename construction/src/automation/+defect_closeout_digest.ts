import { Effect } from 'effect';
import { defineAutomation } from '@norbital-ai/bolt/authoring';

export default defineAutomation(
	{ schedule: '0 6 * * *' },
	{
		description:
			'Counts the defect register every morning at 6am and publishes the first 25 defects as a JSON extract for the closeout meeting.',
		handler: (api) =>
			Effect.gen(function* () {
				const defects = yield* api.db.query.defects.findMany({
					where: { status: { in: ['open', 'in_review', 'ready_for_closeout'] } },
					orderBy: { due_date: 'asc' },
					limit: 25
				});
				return {
					automation_key: 'defect_closeout_digest',
					generated_at: new Date().toISOString(),
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
