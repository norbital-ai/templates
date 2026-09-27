import { automation } from '@norbital-ai/bolt';
import { inspectPendingPhotos } from '../lib/suspicion-review.js';

/**
 * A filed photo is born uninspected; this fills its facts as soon as it is filed. The review of its assignment waits
 * for them (and inspects any still pending itself), so a photo the host cannot read keeps its assignment unread.
 */
const inspect = automation({
	description:
		"When a photo is filed, fills its sha256, perceptual and scene embeddings, integrity flags and near-duplicate matches from the host's image facts.",
	on: { created: 'photo_evidence' },
	output: { kind: 'object', fields: { inspected: { kind: 'int' }, failed: { kind: 'int' } } },
	runAs: ['suspicion_review_automation'],
	concurrency: { max: 1 }
});
export default inspect;

inspect.run(async (_input, ctx) => {
	const { inspected, failures } = await inspectPendingPhotos(ctx);
	return { inspected, failed: failures.length };
});
