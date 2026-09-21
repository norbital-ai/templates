import { defineAutomation, hexToBinaryEmbedding } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';
import type { Row, UpdateInput } from '../collections/photo_evidence/$types.js';
import {
	evaluateCaptureGeolocation,
	inspectPhoto,
	VISUAL_DUPLICATE_MAX_L2
} from '../collections/photo_evidence/photo-integrity.js';
import { coordinatesOf } from '../lib/geo.js';

const OutputSchema = Schema.Struct({
	id: Schema.String,
	flags: Schema.Array(Schema.String),
	matched_evidence_ids: Schema.Array(Schema.String)
});

type Photo = Readonly<{
	readonly id: string;
	readonly job_assignment_id: string | null;
	readonly variation_request_id: string | null;
}>;

/** The assignment a photo hangs off, directly or through its variation request. */
const assignmentIdsOf = (api: Api, photos: ReadonlyArray<Photo>) =>
	Effect.gen(function* () {
		const variationIds = [
			...new Set(
				photos.flatMap((photo) =>
					photo.job_assignment_id == null && photo.variation_request_id != null
						? [photo.variation_request_id]
						: []
				)
			)
		];
		const variations =
			variationIds.length === 0
				? []
				: yield* api.db.variation_requests.findMany({
						where: { id: { in: variationIds } },
						columns: { id: true, job_assignment_id: true },
						limit: variationIds.length
					});
		const byVariation = new Map(
			variations.map((variation) => [variation.id, variation.job_assignment_id])
		);
		return new Map(
			photos.map((photo) => [
				photo.id,
				photo.job_assignment_id ??
					(photo.variation_request_id == null
						? null
						: (byVariation.get(photo.variation_request_id) ?? null))
			])
		);
	});

/**
 * The deterministic evidence pass, run once per photo on the far side of its commit.
 *
 * This used to be the create hook: it needs the bytes, which a collection transform cannot read,
 * so the row is filed uninspected and this fills in the hash, the perceptual embedding, the
 * integrity flags and the duplicates it matched. Matching runs against the stored corpus minus
 * the photo itself and minus anything not yet inspected, so a photograph never flags itself.
 */
export default defineAutomation(
	{ trigger: { collection: 'photo_evidence', event: 'created' } },
	{
		output: OutputSchema,
		policies: ['photo_inspection_automation'],
		description:
			'Hashes a newly filed photo, records its EXIF and quality signals, compares its capture point with the job site, and marks near-duplicates of photos filed under other assignments.',
		handler: (api, { scope }) =>
			Effect.gen(function* () {
				const photo = scope.incoming_record;
				const asset = yield* api.readFileAsset(photo.photo);
				const mimeType = asset.mimeType;
				if (mimeType == null || !mimeType.toLowerCase().startsWith('image/')) {
					return yield* Effect.fail(new Error('Photo evidence requires an image file.'));
				}
				const assignmentId = (yield* assignmentIdsOf(api, [photo])).get(photo.id) ?? null;
				const assignment =
					assignmentId == null
						? undefined
						: yield* api.db.job_assignments.findFirst({
								where: { id: { eq: assignmentId } },
								columns: { site_id: true }
							});
				const site =
					assignment === undefined
						? undefined
						: yield* api.db.sites.findFirst({
								where: { id: { eq: assignment.site_id } },
								columns: { location: true }
							});
				const inspected = yield* inspectPhoto({ bytes: asset.bytes, mimeType });
				const embedding = hexToBinaryEmbedding(inspected.perceptualHash);
				const flags = new Set([
					...inspected.flags,
					...evaluateCaptureGeolocation(
						inspected.captureLocation,
						coordinatesOf(site?.location ?? null)
					)
				]);
				const nearest = yield* api.db.photo_evidence.findNearest({
					column: 'perceptual_embedding',
					probe: embedding,
					metric: 'l2',
					maxDistance: VISUAL_DUPLICATE_MAX_L2,
					limit: 50,
					columns: { id: true, sha256: true, job_assignment_id: true, variation_request_id: true }
				});
				const candidates = nearest.filter(
					(candidate) =>
						candidate.id !== photo.id &&
						candidate.sha256 !== '' &&
						candidate.sha256 !== inspected.sha256
				);
				const candidateAssignments = yield* assignmentIdsOf(api, candidates);
				const matched = candidates.flatMap((candidate) =>
					candidateAssignments.get(candidate.id) === assignmentId ? [] : [candidate.id]
				);
				if (matched.length > 0) flags.add('visual_duplicate');
				const facts: Pick<
					Row,
					'sha256' | 'perceptual_embedding' | 'flags' | 'matched_evidence_ids'
				> = {
					sha256: inspected.sha256,
					perceptual_embedding: embedding,
					flags: [...flags],
					matched_evidence_ids: matched
				};
				const written = yield* api.collection.photo_evidence.update(photo.id, facts);
				return {
					id: written.id,
					flags: written.flags,
					matched_evidence_ids: written.matched_evidence_ids
				};
			})
	}
);
