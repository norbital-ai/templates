import { hexToBinaryEmbedding } from '@norbital-ai/bolt/authoring';
import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { CollectionMutationValues } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { Hooks } from './$types.js';
import { photoSourceValueSchema } from '../../datatypes/photo_source/+definition.js';
import { coordinatesOf, type LocationLike } from '../../lib/geo.js';
import {
	assertExactlyOnePhotoParent,
	assertPhotoEvidenceProvenanceUnchanged,
	evaluateCaptureGeolocation,
	inspectPhoto,
	photoIntegrityFlags,
	VISUAL_DUPLICATE_MAX_L2
} from './photo-integrity.js';

const photoEvidenceCreateInput = Schema.Struct({
	job_assignment_id: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isUUID()))),
	variation_request_id: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isUUID()))),
	photo: Schema.Struct({
		storage_key: Schema.String,
		file_name: Schema.String,
		file_size: Schema.Number,
		mime_type: Schema.String
	}),
	source: Schema.optional(photoSourceValueSchema)
});

type PhotoCreateBefore = NonNullable<
	NonNullable<NonNullable<PhotoEvidenceHooks['mutate']>['perRecord']>['before']
>;
type PhotoCreateAfter = NonNullable<
	NonNullable<NonNullable<PhotoEvidenceHooks['mutate']>['perRecord']>['after']
>;
type PhotoBeforeApi = Parameters<PhotoCreateBefore['handler']>[0]['api'];
type PhotoAfterApi = Parameters<PhotoCreateAfter['handler']>[0]['api'];
type PhotoCreateInput = Schema.Schema.Type<typeof photoEvidenceCreateInput>;
type PhotoRecord = Parameters<PhotoCreateAfter['handler']>[0]['record'];
/**
 * What `prepare` hands the create path: the insert branch of the collection's declarative write.
 *
 * `CollectionMutationValues` is the whole write shape — create *or* update — and the update branch
 * makes every column optional. A prepared create is not optional in any of them, so the branch that
 * carries the required columns is the one named here; `sha256` is required on insert and absent
 * from no created photo, which is what picks it out.
 */
type PhotoCreateMutation = Extract<
	CollectionMutationValues<WorkspaceSchema, 'photo_evidence'>,
	{ readonly sha256: string }
>;

/**
 * The parent chain every photo in the batch hangs off, walked once for all of them.
 *
 * A photo names a job assignment or a variation request, and the site whose coordinates its capture
 * location is judged against is four hops away: variation → assignment → job → site. Asked per photo
 * that is four round trips a row; asked here it is four for the batch. The maps are keyed by id, so
 * a hook that knows only its own record still finds its own answer.
 *
 * `prepare` decides nothing. Whether a parent exists, whether exactly one was named, and what the
 * capture location implies are all still settled in `perRecord.before`, once, for one photo.
 */
interface PhotoEvidenceBatch {
	readonly assignmentByVariation: ReadonlyMap<string, string | null>;
	readonly jobByAssignment: ReadonlyMap<string, string | null>;
	readonly siteByJob: ReadonlyMap<string, string | null>;
	readonly locationBySite: ReadonlyMap<string, LocationLike>;
}

/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<PhotoEvidenceBatch>`.
 */
type PhotoEvidenceHooks = CollectionHooks<WorkspaceSchema, 'photo_evidence', PhotoEvidenceBatch>;

const MAX_BATCH_DUPLICATE_CORPUS = 5_000;
const MAX_BATCH_DUPLICATE_COMPARISONS = 250_000;
const photoIntegrityFlagNames = new Set<string>(photoIntegrityFlags);

function sourceKey(
	source: Schema.Schema.Type<typeof photoSourceValueSchema>,
	storageKey: string
): string {
	return source.kind === 'channel'
		? `${source.provider}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${storageKey}`;
}

/**
 * The site a photo's capture location is judged against, walked through the batch's own maps.
 *
 * This used to be four `findFirst` calls per photo. Nothing about the walk changed — a variation
 * points at an assignment, an assignment at a job, a job at a site — only where the answers come
 * from, and a missing link at any hop still means "no site to contradict".
 */
function siteLocationFor(
	prepared: PhotoEvidenceBatch,
	jobAssignmentId: string | null | undefined,
	variationRequestId: string | null | undefined
): LocationLike {
	const assignmentId =
		jobAssignmentId != null && jobAssignmentId !== ''
			? jobAssignmentId
			: variationRequestId != null && variationRequestId !== ''
				? (prepared.assignmentByVariation.get(variationRequestId) ?? null)
				: null;
	if (assignmentId == null || assignmentId === '') return null;
	const jobId = prepared.jobByAssignment.get(assignmentId) ?? null;
	if (jobId == null) return null;
	const siteId = prepared.siteByJob.get(jobId) ?? null;
	if (siteId == null) return null;
	return prepared.locationBySite.get(siteId) ?? null;
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
	if (variationIds.length === 0) return Effect.succeed(new Map<string, string | null>());
	return Effect.map(
		api.db.variation_requests.findMany({
			where: { id: { in: variationIds } },
			columns: { id: true, job_assignment_id: true },
			limit: Math.max(1, variationIds.length)
		}),
		(variations) =>
			new Map(variations.map((variation) => [variation.id, variation.job_assignment_id ?? null]))
	);
}

function runAfterPhoto(
	record: PhotoRecord,
	api: PhotoAfterApi
): Effect.Effect<void, unknown, never> {
	return Effect.gen(function* () {
		const columns = {
			id: true,
			sha256: true,
			job_assignment_id: true,
			variation_request_id: true
		} as const;
		const visualMatches = yield* api.db.photo_evidence.findNearest({
			column: 'perceptual_embedding',
			probe: record.perceptual_embedding,
			metric: 'l2',
			maxDistance: VISUAL_DUPLICATE_MAX_L2,
			limit: 50,
			columns,
			// The probe's own row is nearest to itself; excluding it is the ordinary where clause.
			where: { id: { ne: record.id } }
		});

		const flags = new Set(record.flags.filter((flag) => photoIntegrityFlagNames.has(flag)));
		const matchedIds = new Set<string>();
		const candidates = [
			...new Map(
				visualMatches
					.filter((candidate) => candidate.id !== record.id)
					.map((candidate) => [candidate.id, candidate])
			).values()
		];
		const assignmentByVariation = yield* assignmentIdsForEvidence(api, [record, ...candidates]);
		const currentAssignmentId = assignmentIdFromEvidence(record, assignmentByVariation);
		const candidateAssignmentIds = new Map(
			candidates.map((candidate) => [
				candidate.id,
				assignmentIdFromEvidence(candidate, assignmentByVariation)
			])
		);

		for (const candidate of visualMatches) {
			if (candidate.id === record.id) continue;
			if (candidate.sha256 === record.sha256) continue;
			if (candidateAssignmentIds.get(candidate.id) === currentAssignmentId) continue;
			flags.add('visual_duplicate');
			matchedIds.add(candidate.id);
		}
		const mergedFlags = [...flags];
		yield* api.db.photo_evidence.mutate({
			id: record.id,
			flags: mergedFlags,
			matched_evidence_ids: [...matchedIds]
		});
	});
}

function preparePhoto(
	api: PhotoBeforeApi,
	parsed: PhotoCreateInput,
	siteLocation: LocationLike
): Effect.Effect<PhotoCreateMutation, unknown, never> {
	return Effect.gen(function* () {
		const asset = yield* api.readFileAsset(parsed.photo);
		const mimeType = asset.mimeType;
		if (mimeType == null || !mimeType.toLowerCase().startsWith('image/')) {
			return yield* Effect.fail(new Error('Photo evidence requires an image file.'));
		}
		const inspected = yield* inspectPhoto({ bytes: asset.bytes, mimeType });
		const geoFlags = evaluateCaptureGeolocation(
			inspected.captureLocation,
			coordinatesOf(siteLocation)
		);
		const source = parsed.source ?? { kind: 'workspace_upload' as const };
		return {
			job_assignment_id: parsed.job_assignment_id,
			variation_request_id: parsed.variation_request_id,
			photo: parsed.photo,
			source,
			source_key: sourceKey(source, asset.id),
			sha256: inspected.sha256,
			perceptual_embedding: hexToBinaryEmbedding(inspected.perceptualHash),
			flags: [...new Set([...inspected.flags, ...geoFlags])],
			matched_evidence_ids: []
		};
	});
}

/** What a caller may state on a write; it types `api.db.photo_evidence.mutate` too. */
export const input = photoEvidenceCreateInput;

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const variationIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.variation_request_id ? [input.variation_request_id] : []
						)
					)
				];
				const variations = variationIds.length
					? yield* api.db.variation_requests.findMany({
							where: { id: { in: variationIds } },
							columns: { id: true, job_assignment_id: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const assignmentByVariation = new Map(
					variations.map((variation) => [variation.id, variation.job_assignment_id])
				);
				const assignmentIds = [
					...new Set([
						...inputs.flatMap((input) =>
							input.job_assignment_id ? [input.job_assignment_id] : []
						),
						...variations.flatMap((variation) =>
							variation.job_assignment_id ? [variation.job_assignment_id] : []
						)
					])
				];
				const assignments = assignmentIds.length
					? yield* api.db.job_assignments.findMany({
							where: { id: { in: assignmentIds } },
							columns: { id: true, job_id: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const jobByAssignment = new Map(
					assignments.map((assignment) => [assignment.id, assignment.job_id])
				);
				const jobIds = [
					...new Set(
						assignments.flatMap((assignment) => (assignment.job_id ? [assignment.job_id] : []))
					)
				];
				const jobs = jobIds.length
					? yield* api.db.jobs.findMany({
							where: { id: { in: jobIds } },
							columns: { id: true, site_id: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const siteByJob = new Map(jobs.map((job) => [job.id, job.site_id]));
				const siteIds = [...new Set(jobs.flatMap((job) => (job.site_id ? [job.site_id] : [])))];
				const sites = siteIds.length
					? yield* api.db.sites.findMany({
							where: { id: { in: siteIds } },
							columns: { id: true, location: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				return {
					assignmentByVariation,
					jobByAssignment,
					siteByJob,
					locationBySite: new Map(sites.map((site) => [site.id, site.location]))
				};
			}),
		perRecord: {
			before: {
				description:
					'Records one photograph against its parent and channel, and thereafter keeps the selected image, parent and channel provenance immutable. Deterministic evidence facts may change without creating or latching a suspicion judgement.',
				handler: ({ input, existing, prepared, api }) => {
					// An edit may not move the photograph; only a create runs the preparation pass.
					if (existing !== undefined) {
						assertPhotoEvidenceProvenanceUnchanged(input, existing);
						return Effect.succeed(input);
					}
					return Effect.gen(function* () {
						const parsed = yield* Schema.decodeUnknownEffect(photoEvidenceCreateInput)(input);
						const jobAssignmentId = parsed.job_assignment_id;
						const variationRequestId = parsed.variation_request_id;
						yield* Effect.try(() =>
							assertExactlyOnePhotoParent(jobAssignmentId, variationRequestId)
						);

						if (jobAssignmentId != null && jobAssignmentId !== '') {
							if (!prepared.jobByAssignment.has(jobAssignmentId)) {
								return yield* Effect.fail(new Error('Referenced job assignment does not exist.'));
							}
						} else if (variationRequestId != null && variationRequestId !== '') {
							if (!prepared.assignmentByVariation.has(variationRequestId)) {
								return yield* Effect.fail(
									new Error('Referenced variation request does not exist.')
								);
							}
						}

						return yield* preparePhoto(
							api,
							parsed,
							siteLocationFor(prepared, jobAssignmentId, variationRequestId)
						);
					});
				}
			},
			after: {
				description: 'Runs the deterministic evidence pass over a newly recorded photograph.',
				handler: ({ previous, record, api }) =>
					// Only a newly recorded photograph is passed; an edit changes facts the pass already read.
					previous === undefined ? runAfterPhoto(record, api) : Effect.void
			}
		}
	}
} satisfies PhotoEvidenceHooks;
