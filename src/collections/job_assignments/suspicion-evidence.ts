import { Option, Schema } from 'effect';

const ReviewCandidate = Schema.Struct({
	id: Schema.String,
	storage_key: Schema.String,
	distance: Schema.Number,
	matched_photo_ids: Schema.Array(Schema.String)
});

const ReviewBasis = Schema.Struct({ candidates: Schema.Array(ReviewCandidate) });
const decodeReviewBasis = Schema.decodeUnknownOption(ReviewBasis);

type ReviewCandidateEvidence = Readonly<{
	readonly id: string;
	readonly storageKey: string;
	readonly distance: number;
	readonly matchedPhotoIds: ReadonlyArray<string>;
}>;

/**
 * Reads the immutable cross-assignment evidence snapshot supplied to the review agent.
 *
 * Reviews are newest-first. A candidate repeated by a later retry is shown once, using the newest
 * stored snapshot; malformed historical basis text is ignored instead of breaking record details.
 */
export const reviewCandidatesFrom = (
	bases: ReadonlyArray<string>
): ReadonlyArray<ReviewCandidateEvidence> => {
	const candidates = new Map<string, ReviewCandidateEvidence>();
	for (const basis of bases) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(basis);
		} catch {
			continue;
		}
		const decoded = decodeReviewBasis(parsed);
		if (Option.isNone(decoded)) continue;
		for (const candidate of decoded.value.candidates) {
			if (candidates.has(candidate.id)) continue;
			candidates.set(candidate.id, {
				id: candidate.id,
				storageKey: candidate.storage_key,
				distance: candidate.distance,
				matchedPhotoIds: [...candidate.matched_photo_ids]
			});
		}
	}
	return [...candidates.values()];
};
