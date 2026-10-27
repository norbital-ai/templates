import { automation } from '@norbital-ai/bolt';
import payment_claims from '../data/model/payment_claims/+model.js';
import { DAILY_0600, digestOutput } from '../lib/digest.js';
const { project_id, job_id, ...fields } = payment_claims.spec.fields;
export default automation('payment_claim_readiness_watch', {
	description:
		'Counts the draft and submitted payment claims every morning at 6am and publishes the 25 most recently changed as a JSON extract so the commercial team can check progress-claim readiness.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput(fields),
	run: function* (_, ctx) {
		const {
			payment_claims: { rows }
		} = yield* ctx.query({
			payment_claims: {
				where: { status: { in: ['draft', 'submitted'] } },
				orderBy: { updated_at: 'desc' },
				limit: 25
			}
		});
		return { generated_at: ctx.now, count: rows.length, rows };
	}
});
