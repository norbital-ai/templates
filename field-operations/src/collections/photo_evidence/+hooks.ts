import { hexToBinaryEmbedding } from '@norbital-ai/pod/authoring';
import { z } from 'zod';
import type { Hooks } from './$types.js';
import { photoSourceSchema } from '../../custom-types/photo_source/+definition.js';
import { coordinatesOf, type LocationLike } from '../../lib/haversine.js';
import {
	assertExactlyOnePhotoParent,
	evaluateCaptureGeolocation,
	inspectPhoto,
	PHOTO_INTEGRITY_INSPECTION_PROFILE,
	photoInspectionSchema,
	photoIntegrityFlags,
	VISUAL_DUPLICATE_MAX_L2,
	type PhotoIntegrityFlag
} from './lib/photo-integrity.js';
import { planDuplicateEvidenceBatch } from './lib/photo-duplicates.js';

const photoEvidenceCreateInput = z
	.object({
		job_assignment_id: z.string().uuid().nullable().optional(),
		variation_request_id: z.string().uuid().nullable().optional(),
		document_asset_id: z.string().uuid(),
		source: photoSourceSchema.optional()
	})
	.strict();

type PhotoCreateBefore = NonNullable<NonNullable<Hooks['create']>['before']>;
type PhotoCreateAfter = NonNullable<NonNullable<Hooks['create']>['after']>;
type PhotoBeforeApi = Parameters<PhotoCreateBefore['handler']>[0]['api'];
type PhotoAfterApi = Parameters<PhotoCreateAfter['handler']>[0]['api'];
type PhotoCreateInput = z.infer<typeof photoEvidenceCreateInput>;
type PhotoRecord = Parameters<PhotoCreateAfter['handler']>[0]['record'];
type CachedPhotoInspection = {
	readonly id: string;
	readonly name: string;
	readonly mimeType: string | null;
	readonly size: number;
	readonly contentSha256: string;
	readonly facts: unknown;
};
type PhotoHooksWithBatch = Hooks & {
	readonly create: NonNullable<Hooks['create']> & {
		readonly before: PhotoCreateBefore & {
			readonly batchHandler: (ctx: {
				readonly inputs: readonly PhotoCreateInput[];
				readonly api: PhotoBeforeApi;
			}) => Promise<readonly Record<string, unknown>[]>;
		};
		readonly after: PhotoCreateAfter & {
			readonly batchHandler: (ctx: {
				readonly records: readonly PhotoRecord[];
				readonly api: PhotoAfterApi;
			}) => Promise<void>;
		};
	};
};

// Decoding and hashing are synchronous on the guest's single vCPU, so workers do not multiply raster
// memory. They overlap only the sealed file-facility reads; eight keeps that IO off the critical path.
const PHOTO_INSPECTION_CONCURRENCY = 8;
const MAX_BATCH_DUPLICATE_CORPUS = 5_000;

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
	const output = new Array<R>(values.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		while (nextIndex < values.length) {
			const index = nextIndex;
			nextIndex += 1;
			output[index] = await mapper(values[index]!, index);
		}
	});
	const settled = await Promise.allSettled(workers);
	const failure = settled.find(
		(result): result is PromiseRejectedResult => result.status === 'rejected'
	);
	if (failure) throw failure.reason;
	return output;
}

function sourceKey(source: z.infer<typeof photoSourceSchema>, assetId: string): string {
	return source.kind === 'channel'
		? `${source.provider}:${source.conversation_id}:${source.attachment_id}`
		: `workspace:${assetId}`;
}

async function resolveSiteLocation(
	api: PhotoBeforeApi,
	jobAssignmentId: string | null | undefined,
	variationRequestId: string | null | undefined
): Promise<LocationLike> {
	let assignmentId = jobAssignmentId;
	if ((assignmentId == null || assignmentId === '') && variationRequestId != null) {
		const variation = await api.db.query.variation_requests.findFirst({
			where: { norbital_id: { eq: variationRequestId } },
			columns: { job_assignment_id: true }
		});
		assignmentId = variation?.job_assignment_id ?? null;
	}
	if (assignmentId == null || assignmentId === '') return null;

	const assignment = await api.db.query.job_assignments.findFirst({
		where: { norbital_id: { eq: assignmentId } },
		columns: { job_id: true }
	});
	if (assignment?.job_id == null) return null;

	const job = await api.db.query.jobs.findFirst({
		where: { norbital_id: { eq: assignment.job_id } },
		columns: { site_id: true }
	});
	if (job?.site_id == null) return null;

	const site = await api.db.query.sites.findFirst({
		where: { norbital_id: { eq: job.site_id } },
		columns: { location: true }
	});
	return site?.location ?? null;
}

async function assignmentIdForEvidence(
	api: PhotoAfterApi,
	evidence: { job_assignment_id?: string | null; variation_request_id?: string | null }
): Promise<string | null> {
	if (evidence.job_assignment_id != null && evidence.job_assignment_id !== '') {
		return evidence.job_assignment_id;
	}
	if (evidence.variation_request_id == null || evidence.variation_request_id === '') return null;
	const variation = await api.db.query.variation_requests.findFirst({
		where: { norbital_id: { eq: evidence.variation_request_id } },
		columns: { job_assignment_id: true }
	});
	return variation?.job_assignment_id ?? null;
}

async function runAfterPhoto(record: PhotoRecord, api: PhotoAfterApi): Promise<void> {
	const columns = {
		norbital_id: true,
		sha256: true,
		job_assignment_id: true,
		variation_request_id: true
	} as const;
	const [exactMatches, visualMatches] = await Promise.all([
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
	]);

	const flags = new Set<PhotoIntegrityFlag>(
		(record.flags ?? []).filter(
			(flag): flag is PhotoIntegrityFlag =>
				typeof flag === 'string' && photoIntegrityFlags.includes(flag as PhotoIntegrityFlag)
		)
	);
	const matchedIds = new Set<string>();
	const currentAssignmentId = await assignmentIdForEvidence(api, record);
	const candidateAssignmentIds = new Map<string, string | null>();
	const candidates = [
		...new Map(
			[...exactMatches, ...visualMatches]
				.filter((candidate) => candidate.norbital_id !== record.norbital_id)
				.map((candidate) => [candidate.norbital_id, candidate])
		).values()
	];
	await Promise.all(
		candidates.map(async (candidate) => {
			candidateAssignmentIds.set(
				candidate.norbital_id,
				await assignmentIdForEvidence(api, candidate)
			);
		})
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
	const mergedFlags = [...flags] as PhotoIntegrityFlag[];
	await api.db.mutate('photo_evidence', [
		{
			norbital_id: record.norbital_id,
			flags: mergedFlags,
			matched_evidence_ids: [...matchedIds]
		}
	]);
}

async function preparePhoto(
	api: PhotoBeforeApi,
	parsed: PhotoCreateInput,
	siteLocation: LocationLike,
	batchInspection?: CachedPhotoInspection | null
) {
	const inspectionApi = api as PhotoBeforeApi & {
		readFileAssetInspection?: (
			assetId: string,
			profile: string
		) => Promise<{
			id: string;
			name: string;
			mimeType: string | null;
			size: number;
			contentSha256: string;
			facts: unknown;
		} | null>;
	};
	const cached =
		batchInspection === undefined && inspectionApi.readFileAssetInspection
			? await inspectionApi.readFileAssetInspection(
					parsed.document_asset_id,
					PHOTO_INTEGRITY_INSPECTION_PROFILE
				)
			: (batchInspection ?? null);
	const uncached = cached == null ? await api.readFileAsset(parsed.document_asset_id) : null;
	const asset = cached ?? uncached!;
	if (asset.mimeType == null || !asset.mimeType.toLowerCase().startsWith('image/')) {
		throw new Error('Photo evidence requires an image file.');
	}
	const inspected = cached
		? photoInspectionSchema.parse(cached.facts)
		: await inspectPhoto({ bytes: uncached!.bytes, mimeType: uncached!.mimeType ?? '' });
	if (cached != null && cached.contentSha256 !== inspected.sha256) {
		throw new Error('Cached photo inspection does not match its verified content digest.');
	}
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
}

export default {
	create: {
		input: photoEvidenceCreateInput,
		before: {
			description:
				'Accepts a photo only as an image filed against exactly one existing job assignment or variation request, then records its hash, perceptual fingerprint, and whether its capture location contradicts the site.',
			batchHandler: async ({ inputs, api }) => {
				const parsedInputs = inputs.map((input) => photoEvidenceCreateInput.parse(input));
				for (const parsed of parsedInputs) {
					assertExactlyOnePhotoParent(parsed.job_assignment_id, parsed.variation_request_id);
				}

				const directAssignmentIds = parsedInputs.flatMap((input) =>
					input.job_assignment_id ? [input.job_assignment_id] : []
				);
				const variationIds = parsedInputs.flatMap((input) =>
					input.variation_request_id ? [input.variation_request_id] : []
				);
				const variations = variationIds.length
					? await api.db.query.variation_requests.findMany({
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
					? await api.db.query.job_assignments.findMany({
							where: { norbital_id: { in: assignmentIds } },
							columns: { norbital_id: true, job_id: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const assignmentsById = new Map(
					assignments.map((assignment) => [assignment.norbital_id, assignment])
				);
				for (const parsed of parsedInputs) {
					if (parsed.job_assignment_id && !assignmentsById.has(parsed.job_assignment_id)) {
						throw new Error('Referenced job assignment does not exist.');
					}
					if (
						parsed.variation_request_id &&
						!variationAssignments.has(parsed.variation_request_id)
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
					? await api.db.query.jobs.findMany({
							where: { norbital_id: { in: jobIds } },
							columns: { norbital_id: true, site_id: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const jobsById = new Map(jobs.map((job) => [job.norbital_id, job]));
				const siteIds = [...new Set(jobs.flatMap((job) => (job.site_id ? [job.site_id] : [])))];
				const sites = siteIds.length
					? await api.db.query.sites.findMany({
							where: { norbital_id: { in: siteIds } },
							columns: { norbital_id: true, location: true },
							limit: MAX_BATCH_DUPLICATE_CORPUS
						})
					: [];
				const sitesById = new Map(sites.map((site) => [site.norbital_id, site.location]));
				const inspectionApi = api as PhotoBeforeApi & {
					readFileAssetInspections?: (
						assetIds: readonly string[],
						profile: string
					) => Promise<readonly (CachedPhotoInspection | null)[]>;
				};
				const inspections = inspectionApi.readFileAssetInspections
					? await inspectionApi.readFileAssetInspections(
							parsedInputs.map((input) => input.document_asset_id),
							PHOTO_INTEGRITY_INSPECTION_PROFILE
						)
					: undefined;
				if (inspections != null && inspections.length !== parsedInputs.length) {
					throw new Error('Photo inspection batch returned an invalid result count.');
				}

				return mapConcurrent(parsedInputs, PHOTO_INSPECTION_CONCURRENCY, async (parsed, index) => {
					const assignmentId =
						parsed.job_assignment_id ??
						(parsed.variation_request_id
							? variationAssignments.get(parsed.variation_request_id)
							: null);
					const jobId = assignmentId ? assignmentsById.get(assignmentId)?.job_id : null;
					const siteId = jobId ? jobsById.get(jobId)?.site_id : null;
					return preparePhoto(
						api,
						parsed,
						siteId ? (sitesById.get(siteId) ?? null) : null,
						inspections?.[index]
					);
				});
			},
			handler: async ({ input, api }) => {
				const parsed = photoEvidenceCreateInput.parse(input);
				const jobAssignmentId = parsed.job_assignment_id;
				const variationRequestId = parsed.variation_request_id;
				assertExactlyOnePhotoParent(jobAssignmentId, variationRequestId);

				if (jobAssignmentId != null && jobAssignmentId !== '') {
					const row = await api.db.query.job_assignments.findFirst({
						where: { norbital_id: { eq: jobAssignmentId } }
					});
					if (row == null) throw new Error('Referenced job assignment does not exist.');
				} else if (variationRequestId != null && variationRequestId !== '') {
					const row = await api.db.query.variation_requests.findFirst({
						where: { norbital_id: { eq: variationRequestId } }
					});
					if (row == null) throw new Error('Referenced variation request does not exist.');
				}

				const siteLocation = await resolveSiteLocation(api, jobAssignmentId, variationRequestId);
				return preparePhoto(api, parsed, siteLocation);
			}
		},
		after: {
			description:
				'Compares a newly filed photo against the rest of the evidence by hash and visual likeness and records deterministic evidence attributes for the multimodal review layer.',
			batchHandler: async ({ records, api }) => {
				const columns = {
					norbital_id: true,
					sha256: true,
					perceptual_embedding: true,
					flags: true,
					job_assignment_id: true,
					variation_request_id: true
				} as const;
				const corpus = await api.db.query.photo_evidence.findMany({
					columns,
					limit: MAX_BATCH_DUPLICATE_CORPUS
				});
				if (corpus.length >= MAX_BATCH_DUPLICATE_CORPUS) {
					// Preserve indexed production semantics at the explicit authoring ceiling. Seed/demo
					// workspaces stay well below it; a mature workspace safely pays the existing per-row path.
					for (const record of records) await runAfterPhoto(record, api);
					return;
				}

				const variationIds = [
					...new Set(
						corpus.flatMap((row) => (row.variation_request_id ? [row.variation_request_id] : []))
					)
				];
				const variations = variationIds.length
					? await api.db.query.variation_requests.findMany({
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
						flags: evidence.flags ?? [],
						assignmentId: assignmentFor(evidence)
					})),
					new Set(records.map((record) => record.norbital_id))
				);
				await api.db.mutate(
					'photo_evidence',
					planned.map((update) => ({
						norbital_id: update.id,
						flags: update.flags,
						matched_evidence_ids: update.matchedEvidenceIds
					}))
				);
			},
			handler: async ({ record, api }) => {
				await runAfterPhoto(record, api);
			}
		}
	},
	update: {
		before: {
			description:
				'Keeps a photo filed against exactly one job assignment or variation request, and refuses to re-parent it onto a record that does not exist.',
			handler: async ({ input, existing, api }) => {
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
					const assignment = await api.db.query.job_assignments.findFirst({
						where: { norbital_id: { eq: jobAssignmentId } }
					});
					if (assignment == null) throw new Error('Referenced job assignment does not exist.');
				} else if (variationRequestId != null && variationRequestId !== '') {
					const variation = await api.db.query.variation_requests.findFirst({
						where: { norbital_id: { eq: variationRequestId } }
					});
					if (variation == null) throw new Error('Referenced variation request does not exist.');
				}

				return input;
			}
		}
	}
} satisfies PhotoHooksWithBatch;
