import { automation } from '@norbital-ai/bolt';
import { inspectPendingPhotos } from '../lib/suspicion-review.js';
/**
 * A filed photo is born uninspected; this fills its facts as soon as it is filed. The review of its assignment waits
 * for them (and inspects any still pending itself); a review that waited on a photo this run took is started again
 * once the photo is settled, inspected or durably failed.
 */
export default automation('inspect_photo_evidence', {
	description:
		"Started when a photo is filed (`photo_evidence.effect.created`): fills its sha256, perceptual and scene embeddings, integrity flags and near-duplicate matches from the host's image facts.",
	output: { kind: 'object', fields: { inspected: { kind: 'int' }, failed: { kind: 'int' } } },
	policies: ['suspicion_review_automation'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const { inspected, failures, settled } = yield* inspectPendingPhotos(ctx);
		const { job_assignments: waiting } = settled.length
			? yield* ctx.query({
					job_assignments: {
						where: { id: { in: settled }, suspicion_checked_at: { isNull: true } },
						fields: ['id']
					}
				})
			: { job_assignments: { rows: [] } };
		if (waiting.rows.length > 0)
			yield* ctx.schedule('review_job_assignment_suspicion', {
				ids: waiting.rows.map((job) => job.id)
			});
		return { inspected, failed: failures.length };
	}
});
