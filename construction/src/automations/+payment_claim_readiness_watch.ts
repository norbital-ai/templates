import { Effect } from 'effect';
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
			'Counts the payment claims on the books every morning at 6am and publishes the first 25 as a JSON extract so the commercial team can check progress-claim readiness.',
		handler: (api) =>
			Effect.gen(function* () {
				const claims = yield* api.db.query.payment_claims.findMany({
					where: { status: { in: ['draft', 'submitted'] } },
					orderBy: { norbital_updated_at: 'desc' },
					limit: 25
				});
				return {
					automation_key: 'payment_claim_readiness_watch',
					generated_at: new Date().toISOString(),
					summary: { payment_claim_count: claims.length },
					exports: [
						{
							filename: 'payment-claim-readiness-watch.json',
							content_type: 'application/json',
							rows: claims
						}
					]
				};
			})
	}
);
