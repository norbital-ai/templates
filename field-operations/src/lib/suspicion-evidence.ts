import type { Id, Row } from '@norbital-ai/bolt';
type ReviewCandidateEvidence = {
	readonly id: Id<'photo_evidence'>;
	readonly distance: number;
	readonly matchedPhotoIds: readonly Id<'photo_evidence'>[];
};
/** Candidates from immutable, decoded review bases, newest first. */
export function reviewCandidatesFrom(
	bases: readonly Row<'suspicion_reviews'>['basis'][]
): ReviewCandidateEvidence[] {
	const found = new Map<Id<'photo_evidence'>, ReviewCandidateEvidence>();
	for (const basis of bases)
		for (const candidate of basis.candidates)
			if (!found.has(candidate.id))
				found.set(candidate.id, {
					id: candidate.id,
					distance: candidate.distance,
					matchedPhotoIds: candidate.matched_photo_ids
				});
	return [...found.values()];
}
