import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import model from './+model.js';
import type { CreateInput, UpdateInput } from './$types.js';
import {
	assertExactlyOnePhotoParent,
	assertPhotoEvidenceProvenanceUnchanged,
	PDQ_DIMENSIONS,
	photoSourceKey
} from './photo-integrity.js';

const PARENT_BATCH_LIMIT = 5_000;

/**
 * A photo is filed against exactly one assignment or variation. Every create through this
 * surface is a workspace upload: `source` is `notNull` with no default, so selecting it would make
 * every caller state it, and no channel ingests photos through the API today — the seed loader
 * writes channel-sourced rows directly. The integrity facts — hash, perceptual embedding, flags, duplicates — need the bytes, which a
 * transform cannot read, so the row is born uninspected (empty hash, zero vector) and the
 * `inspect_photo_evidence` automation fills them in on the `created` event. Provenance is immutable
 * once filed; the facts may change, which is what the update selection carries alongside the
 * columns the read-only record panel shows.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: { job_assignment_id: true, variation_request_id: true, photo: true }
		}
	},
	update: {
		input: {
			columns: {
				job_assignment_id: true,
				variation_request_id: true,
				photo: true,
				source: true,
				source_key: true,
				sha256: true,
				perceptual_embedding: true,
				flags: true,
				matched_evidence_ids: true
			}
		}
	},
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const creates = inputs.flatMap((input, index) =>
				existing[index] === undefined && 'photo' in input ? [input] : []
			);
			const assignmentIds = [
				...new Set(
					creates.flatMap((input) => (input.job_assignment_id ? [input.job_assignment_id] : []))
				)
			];
			const variationIds = [
				...new Set(
					creates.flatMap((input) =>
						input.variation_request_id ? [input.variation_request_id] : []
					)
				)
			];
			const [assignments, variations] = yield* Effect.all(
				[
					assignmentIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { id: { in: assignmentIds } },
								columns: { id: true },
								limit: PARENT_BATCH_LIMIT
							}),
					variationIds.length === 0
						? Effect.succeed([])
						: db.variation_requests.findMany({
								where: { id: { in: variationIds } },
								columns: { id: true },
								limit: PARENT_BATCH_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			const knownAssignments = new Set(assignments.map((assignment) => assignment.id));
			const knownVariations = new Set(variations.map((variation) => variation.id));
			return inputs.map((input, index) => {
				const stored = existing[index];
				if (stored !== undefined) {
					const patch = input as UpdateInput;
					assertPhotoEvidenceProvenanceUnchanged(patch, stored);
					return patch;
				}
				if (!('photo' in input)) refuse('Photo evidence names no photo.');
				const filed = input as CreateInput;
				assertExactlyOnePhotoParent(filed.job_assignment_id, filed.variation_request_id);
				if (filed.job_assignment_id && !knownAssignments.has(filed.job_assignment_id)) {
					refuse('Referenced job assignment does not exist.');
				}
				if (filed.variation_request_id && !knownVariations.has(filed.variation_request_id)) {
					refuse('Referenced variation request does not exist.');
				}
				const source = { kind: 'workspace_upload' as const };
				return {
					job_assignment_id: filed.job_assignment_id ?? null,
					variation_request_id: filed.variation_request_id ?? null,
					photo: filed.photo,
					source,
					source_key: photoSourceKey(source, filed.photo.storage_key),
					// ponytail: born uninspected — an empty hash and a zero vector until the created-event
					// automation reads the bytes. Nullable fact columns would say this honestly; that is a
					// schema migration, not this step.
					sha256: '',
					perceptual_embedding: new Array<number>(PDQ_DIMENSIONS).fill(0),
					flags: [],
					matched_evidence_ids: []
				};
			});
		})
});
