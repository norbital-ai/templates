import type { Id } from '@norbital-ai/bolt';
import * as Predicate from './guards.js';

/** A cross-assignment candidate as a review's stored basis records it: a photo the review wrote by its id. */
export type ReviewCandidateEvidence = {
	readonly id: Id<'photo_evidence'>;
	readonly distance: number;
	readonly matchedPhotoIds: readonly string[];
};

const isCandidate = (
	value: unknown
): value is { id: Id<'photo_evidence'>; distance: number; matched_photo_ids: string[] } =>
	Predicate.isObjectOrArray(value) &&
	Predicate.isString((value as { id?: unknown }).id) &&
	Predicate.isNumber((value as { distance?: unknown }).distance) &&
	Array.isArray((value as { matched_photo_ids?: unknown }).matched_photo_ids);

/**
 * The cross-assignment candidates the review showed the model, from the reviews' immutable bases, newest first: a
 * candidate a later retry repeated is shown once, from the newest basis; a malformed historical basis is skipped.
 */
export function reviewCandidatesFrom(bases: readonly string[]): ReviewCandidateEvidence[] {
	const found = new Map<Id<'photo_evidence'>, ReviewCandidateEvidence>();
	for (const basis of bases) {
		let candidates: unknown;
		try {
			const parsed: unknown = JSON.parse(basis);
			candidates = (parsed as { candidates?: unknown })?.candidates;
		} catch {
			continue;
		}
		if (!Array.isArray(candidates)) continue;
		for (const candidate of candidates)
			if (isCandidate(candidate) && !found.has(candidate.id))
				found.set(candidate.id, {
					id: candidate.id,
					distance: candidate.distance,
					matchedPhotoIds: candidate.matched_photo_ids.map(String)
				});
	}
	return [...found.values()];
}
