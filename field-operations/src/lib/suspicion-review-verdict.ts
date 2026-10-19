import * as Schema from 'effect/Schema';
import type { Decision, ReviewCandidate, ReviewPhoto } from './suspicion-review.js';
import { assetName, clipText, MAX_INFERENCE_REASON_CHARS } from './suspicion-review-text.js';

export type Pair = {
	readonly own: ReviewPhoto;
	readonly candidate: ReviewCandidate;
	readonly attached: boolean;
};

export class ReviewDecisionInvalid extends Schema.TaggedError<ReviewDecisionInvalid>()(
	'ReviewDecisionInvalid',
	{ message: Schema.String }
) {}

/**
 * The verdict a decision supports: a job-site suspicion counts only when it cites an attached job-site asset; each
 * pair judged the same scene adds its reuse. Model pair prose never enters the log.
 */
export function judge(
	representatives: readonly ReviewPhoto[],
	decision: Decision,
	reused: readonly Pair[]
) {
	if (decision.reason.trim() === '')
		throw new ReviewDecisionInvalid({ message: 'Suspicion review returned an empty reason.' });
	const site = decision;
	const cited =
		site.evidence_asset_name === ''
			? null
			: (representatives.find((photo) => assetName(photo) === site.evidence_asset_name)?.id ??
				null);
	const supported = site.suspicious && cited !== null;
	const unsupported = site.suspicious && cited === null;
	const suspicious = supported || reused.length > 0;
	const reason = clipText(
		[
			...(supported ? [site.reason] : []),
			...reused.map(
				({ own, candidate }) =>
					`Cross-assignment photo reuse: ${assetName(own)} and ${assetName(candidate)} were judged to show the same physical scene.`
			),
			...(!suspicious && unsupported
				? [
						'No suspicion log was created because the review did not identify an attached job-site asset by its supplied name.'
					]
				: []),
			...(!suspicious && !unsupported ? [site.reason] : [])
		].join(' '),
		MAX_INFERENCE_REASON_CHARS
	);
	return { suspicious, reason, evidence_id: supported ? cited : (reused[0]?.own.id ?? null) };
}
