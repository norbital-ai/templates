import { hexToBinaryEmbedding } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Hooks } from './$types.js';
import { photoSourceSchema } from '../../custom-types/photo_source/+definition.js';
import {
	assertExactlyOnePhotoParent,
	evaluateCaptureGeolocation,
	inspectPhoto,
	photoIntegrityFlags,
	planDuplicateEvidenceBatch,
	VISUAL_DUPLICATE_MAX_L2,
	type PhotoIntegrityFlag
} from './photo-integrity.js';

type LocationLike =
	| {
			geometry?: { lat?: number | null; lon?: number | null } | null;
	  }
	| null
	| undefined;

function coordinatesOf(location: LocationLike): { lat: number; lon: number } | null {
	const lat = location?.geometry?.lat;
	const lon = location?.geometry?.lon;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

const photoEvidenceCreateInput = Schema.Struct({
	job_assignment_id: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isUUID()))),
	variation_request_id: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isUUID()))),
	document_asset_id: Schema.String.check(Schema.isUUID()),
	source: Schema.optional(photoSourceSchema)
});

type PhotoCreateBefore = NonNullable<NonNullable<Hooks['create']>['before']>;
type PhotoCreateAfter = NonNullable<NonNullable<Hooks['create']>['after']>;
type PhotoBeforeApi = Parameters<PhotoCreateBefore['handler']>[0]['api'];
type PhotoAfterApi = Parameters<PhotoCreateAfter['handler']>[0]['api'];
type PhotoCreateInput = Parameters<PhotoCreateBefore['handler']>[0]['input'];
type PhotoRecord = Parameters<PhotoCreateAfter['handler']>[0]['record'];
type PhotoCreateMutation = Parameters<
	NonNullable<PhotoCreateBefore['batchHandler']>
>[0]['inputs'][number];

// Decoding and hashing are synchronous on the guest's single vCPU, so workers do not multiply raster
// memory. They overlap only the sealed file-facility reads; eight keeps that IO off the critical path.
const PHOTO_INSPECTION_CONCURRENCY = 8;
const MAX_BATCH_DUPLICATE_CORPUS = 5_000;

function sourceKey(source: Schema.Schema.Type<typeof photoSourceSchema>, assetId: string): string {
	return source.kind === 'channel'
		? `${source.provider}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${assetId}`;
}

function resolveSiteLocation(
	api: PhotoBeforeApi,
	jobAssignmentId: string | null | undefined,
	variationRequestId: string | null | undefined
): Effect.Effect<LocationLike, unknown, never> {
	return Effect.gen(function* () {
		let assignmentId = jobAssignmentId;
		if ((assignmentId == null || assignmentId === '') && variationRequestId != null) {
			const variation = yield* api.db.query.variation_requests.findFirst({
				where: { norbital_id: { eq: variationRequestId } },
				columns: { job_assignment_id: true }
			});
			assignmentId = variation?.job_assignment_id ?? null;
		}
		if (assignmentId == null || assignmentId === '') return null;

		const assignment = yield* api.db.query.job_assignments.findFirst({
			where: { norbital_id: { eq: assignmentId } },
			columns: { job_id: true }
		});
		if (assignment?.job_id == null) return null;

		const job = yield* api.db.query.jobs.findFirst({
			where: { norbital_id: { eq: assignment.job_id } },
			columns: { site_id: true }
		});
		if (job?.site_id == null) return null;

		const site = yield* api.db.query.sites.findFirst({
			where: { norbital_id: { eq: job.site_id } },
			columns: { location: true }
		});
		return site?.location ?? null;
	});
}

function assignmentIdFromEvidence(
	evidence: { job_assignment_id?: string | null; variation_request_id?: string | null },
	assignmentByVariation: ReadonlyMap<string, string | null>
): string | null {
	if (evidence.job_assignment_id != null && evidence.job_assignment_id !== '') {
		return evidence.job_assignment_id;
	}
	if (evidence.variation_request_id == null || evidence.variation_request_id === '') return null;
	return assignmentByVariation.get(evidence.variation_request_id) ?? null;
}

function assignmentIdsForEvidence(
	api: PhotoAfterApi,
	records: readonly {
		readonly job_assignment_id?: string | null;
		readonly variation_request_id?: string | null;
	}[]
): Effect.Effect<ReadonlyMap<string, string | null>, unknown, never> {
	return Effect.gen(function* () {
		const variationIds = [
			...new Set(
				records.flatMap((record) =>
					(record.job_assignment_id == null || record.job_assignment_id === '') &&
					record.variation_request_id != null &&
					record.variation_request_id !== ''
						? [record.variation_request_id]
						: []
				)
			)
		];
		const variations = variationIds.length
			? yield* api.db.query.variation_requests.findMany({
					where: { norbital_id: { in: variationIds } },
					columns: { norbital_id: true, job_assignment_id: true },
					limit: Math.max(1, variationIds.length)
				})
			: [];
		return new Map(
			variations.map((variation) => [variation.norbital_id, variation.job_assignment_id ?? null])
		);
	});
}

function runAfterPhoto(
	record: PhotoRecord,
	api: PhotoAfterApi
): Effect.Effect<void, unknown, never> {
	return Effect.gen(function* () {
		const columns = {
			norbital_id: true,
			sha256: true,
			job_assignment_id: true,
			variation_request_id: true
		} as const;
		const [exactMatches, visualMatches] = yield* Effect.all(
			[
				api.db.query.photo_evidence.findMany({
					where: { sha256: { eq: record.sha256 } },
					columns,
					limit: 21
				}),
				api.db.query.photo_evidence.findNearest({
					column: 'perceptual_embedding',
					probe: record.perceptual_embedding,
					metric: 'l2',
					maxDistance: VISUAL_DUPLICATE_MAX_L2,
					limit: 50,
					excludeIds: [record.norbital_id]
				})
			],
			{ concurrency: 'unbounded' }
		);

		const flags = new Set<PhotoIntegrityFlag>(
			record.flags.filter((flag): flag is PhotoIntegrityFlag =>
				photoIntegrityFlags.some((candidate) => candidate === flag)
			)
		);
		const matchedIds = new Set<string>();
		const candidates = [
			...new Map(
				[...exactMatches, ...visualMatches]
					.filter((candidate) => candidate.norbital_id !== record.norbital_id)
					.map((candidate) => [candidate.norbital_id, candidate])
			).values()
		];
		const assignmentByVariation = yield* assignmentIdsForEvidence(api, [record, ...candidates]);
		const currentAssignmentId = assignmentIdFromEvidence(record, assignmentByVariation);
		const candidateAssignmentIds = new Map(
			candidates.map((candidate) => [
				candidate.norbital_id,
				assignmentIdFromEvidence(candidate, assignmentByVariation)
			])
		);

		for (const candidate of exactMatches) {
			if (candidate.norbital_id === record.norbital_id) continue;
			if (candidateAssignmentIds.get(candidate.norbital_id) === currentAssignmentId) continue;
			flags.add('exact_duplicate');
			matchedIds.add(candidate.norbital_id);
		}
		for (const candidate of visualMatches) {
			if (candidate.norbital_id === record.norbital_id) continue;
			if (candidate.sha256 === record.sha256) continue;
			if (candidateAssignmentIds.get(candidate.norbital_id) === currentAssignmentId) continue;
			flags.add('visual_duplicate');
			matchedIds.add(candidate.norbital_id);
		}
		const mergedFlags = [...flags];
		yield* api.db.photo_evidence.mutate([
			{
				norbital_id: record.norbital_id,
				flags: mergedFlags,
				matched_evidence_ids: [...matchedIds]
			}
		]);
	});
}

function preparePhoto(
	api: PhotoBeforeApi,
	parsed: PhotoCreateInput,
	siteLocation: LocationLike
): Effect.Effect<PhotoCreateMutation, unknown, never> {
	return Effect.gen(function* () {
		const asset = yield* api.readFileAsset(parsed.document_asset_id);
		const mimeType = asset.mimeType;
		if (mimeType == null || !mimeType.toLowerCase().startsWith('image/')) {
			throw new Error('Photo evidence requires an image file.');
		}
		const inspected = yield* Effect.tryPromise(() =>
			inspectPhoto({ bytes: asset.bytes, mimeType })
		);
		const geoFlags = evaluateCaptureGeolocation(
			inspected.captureLocation,
			coordinatesOf(siteLocation)
		);
		const source = parsed.source ?? { kind: 'workspace_upload' as const };
		return {
			job_assignment_id: parsed.job_assignment_id,
			variation_request_id: parsed.variation_request_id,
			document_asset_id: parsed.document_asset_id,
			source,
			source_key: sourceKey(source, asset.id),
			sha256: inspected.sha256,
			perceptual_embedding: hexToBinaryEmbedding(inspected.perceptualHash),
			flags: [...new Set([...inspected.flags, ...geoFlags])],
			matched_evidence_ids: [],
			site_identity_status: 'pending' as const,
			site_identity_checked_at: null,
			site_identity_error: null
		};
	});
}

export default {
	create: {
		input: photoEvidenceCreateInput,
		before: {
			description:
				'Accepts a photo only as an image filed against exactly one existing job assignment or variation request, then records its hash, perceptual fingerprint, and whether its capture location contradicts the site.',
			batchHandler: ({ inputs, api }) =>
				Effect.gen(function* () {
					for (const input of inputs) {
						assertExactlyOnePhotoParent(input.job_assignment_id, input.variation_request_id);
					}

					const directAssignmentIds = inputs.flatMap((input) =>
						input.job_assignment_id ? [input.job_assignment_id] : []
					);
					const variationIds = inputs.flatMap((input) =>
						input.variation_request_id ? [input.variation_request_id] : []
					);
					const variations = variationIds.length
						? yield* api.db.query.variation_requests.findMany({
								where: { norbital_id: { in: [...new Set(variationIds)] } },
								columns: { norbital_id: true, job_assignment_id: true },
								limit: MAX_BATCH_DUPLICATE_CORPUS
							})
						: [];
					const variationAssignments = new Map(
						variations.map((variation) => [variation.norbital_id, variation.job_assignment_id])
					);
					const assignmentIds = [
						...new Set([
							...directAssignmentIds,
							...variations.flatMap((variation) =>
								variation.job_assignment_id ? [variation.job_assignment_id] : []
							)
						])
					];
					const assignments = assignmentIds.length
						? yield* api.db.query.job_assignments.findMany({
								where: { norbital_id: { in: assignmentIds } },
								columns: { norbital_id: true, job_id: true },
								limit: MAX_BATCH_DUPLICATE_CORPUS
							})
						: [];
					const assignmentsById = new Map(
						assignments.map((assignment) => [assignment.norbital_id, assignment])
					);
					for (const input of inputs) {
						if (input.job_assignment_id && !assignmentsById.has(input.job_assignment_id)) {
							throw new Error('Referenced job assignment does not exist.');
						}
						if (
							input.variation_request_id &&
							!variationAssignments.has(input.variation_request_id)
						) {
							throw new Error('Referenced variation request does not exist.');
						}
					}

					const jobIds = [
						...new Set(
							assignments.flatMap((assignment) => (assignment.job_id ? [assignment.job_id] : []))
						)
					];
					const jobs = jobIds.length
						? yield* api.db.query.jobs.findMany({
								where: { norbital_id: { in: jobIds } },
								columns: { norbital_id: true, site_id: true },
								limit: MAX_BATCH_DUPLICATE_CORPUS
							})
						: [];
					const jobsById = new Map(jobs.map((job) => [job.norbital_id, job]));
					const siteIds = [...new Set(jobs.flatMap((job) => (job.site_id ? [job.site_id] : [])))];
					const sites = siteIds.length
						? yield* api.db.query.sites.findMany({
								where: { norbital_id: { in: siteIds } },
								columns: { norbital_id: true, location: true },
								limit: MAX_BATCH_DUPLICATE_CORPUS
							})
						: [];
					const sitesById = new Map(sites.map((site) => [site.norbital_id, site.location]));

					return yield* Effect.all(
						inputs.map((input) =>
							Effect.gen(function* () {
								const assignmentId =
									input.job_assignment_id ??
									(input.variation_request_id
										? variationAssignments.get(input.variation_request_id)
										: null);
								const jobId = assignmentId ? assignmentsById.get(assignmentId)?.job_id : null;
								const siteId = jobId ? jobsById.get(jobId)?.site_id : null;
								return yield* preparePhoto(
									api,
									input,
									siteId ? (sitesById.get(siteId) ?? null) : null
								);
							})
						),
						{ concurrency: PHOTO_INSPECTION_CONCURRENCY }
					);
				}),
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					const jobAssignmentId = input.job_assignment_id;
					const variationRequestId = input.variation_request_id;
					assertExactlyOnePhotoParent(jobAssignmentId, variationRequestId);

					if (jobAssignmentId != null && jobAssignmentId !== '') {
						const row = yield* api.db.query.job_assignments.findFirst({
							where: { norbital_id: { eq: jobAssignmentId } }
						});
						if (row == null) throw new Error('Referenced job assignment does not exist.');
					} else if (variationRequestId != null && variationRequestId !== '') {
						const row = yield* api.db.query.variation_requests.findFirst({
							where: { norbital_id: { eq: variationRequestId } }
						});
						if (row == null) throw new Error('Referenced variation request does not exist.');
					}

					const siteLocation = yield* resolveSiteLocation(api, jobAssignmentId, variationRequestId);
					return yield* preparePhoto(api, input, siteLocation);
				})
		},
		after: {
			description:
				'Compares a newly filed photo against the rest of the evidence by hash and visual likeness and records deterministic evidence attributes for the multimodal review layer.',
			batchHandler: ({ records, api }) =>
				Effect.gen(function* () {
					const columns = {
						norbital_id: true,
						sha256: true,
						perceptual_embedding: true,
						flags: true,
						job_assignment_id: true,
						variation_request_id: true
					} as const;
					const corpus = yield* api.db.query.photo_evidence.findMany({
						columns,
						limit: MAX_BATCH_DUPLICATE_CORPUS
					});
					if (corpus.length >= MAX_BATCH_DUPLICATE_CORPUS) {
						// Preserve indexed production semantics at the explicit authoring ceiling. Seed/demo
						// workspaces stay well below it; a mature workspace safely pays the existing per-row path.
						for (const record of records) yield* runAfterPhoto(record, api);
						return;
					}

					const variationIds = [
						...new Set(
							corpus.flatMap((row) => (row.variation_request_id ? [row.variation_request_id] : []))
						)
					];
					const variations = variationIds.length
						? yield* api.db.query.variation_requests.findMany({
								where: { norbital_id: { in: variationIds } },
								columns: { norbital_id: true, job_assignment_id: true },
								limit: MAX_BATCH_DUPLICATE_CORPUS
							})
						: [];
					const variationAssignments = new Map(
						variations.map((variation) => [variation.norbital_id, variation.job_assignment_id])
					);
					const assignmentFor = (row: {
						job_assignment_id?: string | null;
						variation_request_id?: string | null;
					}) =>
						row.job_assignment_id ??
						(row.variation_request_id
							? (variationAssignments.get(row.variation_request_id) ?? null)
							: null);
					const planned = planDuplicateEvidenceBatch(
						corpus.map((evidence) => ({
							id: evidence.norbital_id,
							sha256: evidence.sha256,
							perceptualEmbedding: evidence.perceptual_embedding,
							flags: evidence.flags,
							assignmentId: assignmentFor(evidence)
						})),
						new Set(records.map((record) => record.norbital_id))
					);
					yield* api.db.photo_evidence.mutate(planned.map((update) => ({
							norbital_id: update.id,
							flags: update.flags,
							matched_evidence_ids: update.matchedEvidenceIds
						}))
					);
				}),
			handler: ({ record, api }) =>
				Effect.gen(function* () {
					yield* runAfterPhoto(record, api);
				})
		}
	},
	update: {
		before: {
			description:
				'Keeps a photo filed against exactly one job assignment or variation request, and refuses to re-parent it onto a record that does not exist.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					if (input.job_assignment_id === undefined && input.variation_request_id === undefined) {
						return input;
					}
					const jobAssignmentId =
						input.job_assignment_id === undefined
							? existing.job_assignment_id
							: input.job_assignment_id;
					const variationRequestId =
						input.variation_request_id === undefined
							? existing.variation_request_id
							: input.variation_request_id;
					assertExactlyOnePhotoParent(jobAssignmentId, variationRequestId);

					if (jobAssignmentId != null && jobAssignmentId !== '') {
						const assignment = yield* api.db.query.job_assignments.findFirst({
							where: { norbital_id: { eq: jobAssignmentId } }
						});
						if (assignment == null) throw new Error('Referenced job assignment does not exist.');
					} else if (variationRequestId != null && variationRequestId !== '') {
						const variation = yield* api.db.query.variation_requests.findFirst({
							where: { norbital_id: { eq: variationRequestId } }
						});
						if (variation == null) throw new Error('Referenced variation request does not exist.');
					}

					return input;
				})
		}
	}
} satisfies Hooks;
