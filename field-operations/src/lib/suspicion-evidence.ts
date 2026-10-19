import type { Id, Row } from '@norbital-ai/bolt';
import { IdValue } from '@norbital-ai/std/kind';
import { Schema } from 'effect';
const photoKind = Schema.toType(IdValue);
const photoId = Schema.decodeUnknownSync(
	Schema.declare<Id<'photo_evidence'>>(
		(input): input is Id<'photo_evidence'> =>
			Schema.is(Schema.String)(input) && Schema.is(photoKind)(input)
	)
);
type ReviewCandidateEvidence = {
	readonly id: Id<'photo_evidence'>;
	readonly distance: number;
	readonly matchedPhotoIds: readonly Id<'photo_evidence'>[];
};
/** Candidates from immutable, decoded review bases, newest first. */
export function reviewCandidatesFrom(
	bases: readonly Row<'suspicion_reviews'>['basis'][]
): ReviewCandidateEvidence[] {
	const found = new Map<string, ReviewCandidateEvidence>();
	for (const basis of bases)
		for (const candidate of basis.candidates)
			if (!found.has(candidate.id))
				found.set(candidate.id, {
					id: photoId(candidate.id),
					distance: candidate.distance,
					matchedPhotoIds: candidate.matched_photo_ids.map((id) => photoId(id))
				});
	return [...found.values()];
}
