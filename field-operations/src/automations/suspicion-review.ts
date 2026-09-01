import { sha256Text } from '@norbital-ai/std/reckon/hash';
import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';
import { currentDate } from '../lib/clock.js';

// These judgements consume photographs and a strict JSON Schema in the same turn. Keep them on a
// provider model with native vision + structured-output support.
// Adapter-qualified per the host model registry contract: `<adapter>/<provider-model>`.
const SUSPICION_REVIEW_MODEL = 'openrouter/deepseek/deepseek-v4-flash-vision-exp';
export const ASSIGNMENT_PAGE_SIZE = 500;
const MAX_RELATED_ROWS = 5_000;
export const MAX_INFERENCE_IMAGES = 3;
export const MAX_INFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_INFERENCE_CONTEXT_CHARS = 48 * 1024;
export const MAX_INFERENCE_REASON_CHARS = 600;
export const MAX_INFERENCE_ASSET_NAME_CHARS = 256;
const MAX_INFERENCE_COMMUNICATIONS = 24;
const MAX_INFERENCE_MESSAGE_CHARS = 800;
const MAX_SIGNAL_IMAGES = 2;
const MAX_CROSS_ASSIGNMENT_PROBES = 64;

/**
 * Cross-assignment reuse candidates are retrieved with a deliberately generous perceptual band.
 *
 * The deterministic `visual_duplicate` flag stays on the strict near-duplicate bar (Hamming ≤ 31),
 * which a crop, a zoom or a recompression easily exceeds. Candidates pulled here only nominate a
 * pair for visual judgement; the inference decides whether two photos show the same scene, so the
 * band can stay wide enough to catch reused-and-cropped evidence without flagging anything by
 * itself.
 */
export const CROSS_ASSIGNMENT_MAX_HAMMING = 64;
const CROSS_ASSIGNMENT_MAX_L2 = Math.sqrt(CROSS_ASSIGNMENT_MAX_HAMMING);
const MAX_CROSS_ASSIGNMENT_CANDIDATES = 2;
/** Candidates above this size are listed as facts but do not consume the visual attachment budget. */
const MAX_CANDIDATE_IMAGE_BYTES = 1024 * 1024;

const PHOTO_FLAGS = [
	'exact_duplicate',
	'visual_duplicate',
	'metadata_anomaly',
	'edited_metadata',
	'low_quality',
	'missing_geolocation',
	'location_mismatch'
] as const;

const REVIEW_SIGNAL_WEIGHT: Readonly<Record<(typeof PHOTO_FLAGS)[number], number>> = {
	exact_duplicate: 7,
	visual_duplicate: 6,
	location_mismatch: 5,
	edited_metadata: 4,
	metadata_anomaly: 3,
	low_quality: 2,
	// Missing GPS is still reported in the aggregate facts, but it does not make a picture more
	// worthy of the scarce visual slots: messaging providers routinely strip it.
	missing_geolocation: 0
};

const jobSiteDecisionSchema = Schema.Struct({
	suspicious: Schema.Boolean,
	reason: Schema.String.pipe(
		Schema.check(Schema.isPattern(/^\s*\S[\s\S]*$/)),
		Schema.check(Schema.isMaxLength(MAX_INFERENCE_REASON_CHARS))
	),
	evidence_asset_name: Schema.NullOr(
		Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_INFERENCE_ASSET_NAME_CHARS)))
	)
});

const similarPhotoDecisionSchema = Schema.Struct({
	job_site_asset_name: Schema.String.pipe(
		Schema.check(Schema.isMaxLength(MAX_INFERENCE_ASSET_NAME_CHARS))
	),
	similar_asset_name: Schema.String.pipe(
		Schema.check(Schema.isMaxLength(MAX_INFERENCE_ASSET_NAME_CHARS))
	),
	same_scene: Schema.Boolean,
	reason: Schema.String.pipe(
		Schema.check(Schema.isPattern(/^\s*\S[\s\S]*$/)),
		Schema.check(Schema.isMaxLength(MAX_INFERENCE_REASON_CHARS))
	)
});

const inferenceDecisionSchema = Schema.Struct({
	job_site_review: jobSiteDecisionSchema,
	similar_photo_reviews: Schema.Array(similarPhotoDecisionSchema)
});

export const suspicionInferenceSchema = inferenceDecisionSchema;

type SuspicionInferenceDecision = Schema.Schema.Type<typeof inferenceDecisionSchema>;
type JobSiteDecision = Schema.Schema.Type<typeof jobSiteDecisionSchema>;

export type SuspicionReviewFacts = {
	readonly assignment: {
		readonly id: string;
		readonly job_id: string;
		readonly status: string | null;
		readonly summary: string | null;
		readonly location: unknown;
		readonly suspicion_checked_at?: string | null;
	};
	readonly job: {
		readonly id: string;
		readonly title: string;
		readonly nature: string | null;
		readonly scheduled_for: unknown;
		readonly description: string;
	} | null;
	readonly site: {
		readonly id: string;
		readonly name: string;
		readonly location: unknown;
		readonly house_type: string | null;
	} | null;
	readonly photos: ReadonlyArray<{
		readonly id: string;
		readonly photo: {
			readonly storage_key: string;
			readonly file_name: string;
			readonly file_size: number;
			readonly mime_type: string;
		};
		readonly sha256: string;
		readonly flags: ReadonlyArray<string>;
		readonly matched_evidence_ids: ReadonlyArray<string>;
		readonly created_at: string | null;
		/** Loaded only for the review's own rows, as the probe for candidate retrieval. */
		readonly perceptual_embedding?: readonly number[];
		/**
		 * The platform's record embedding, which is what candidate retrieval actually probes with.
		 *
		 * PDQ answers "are these the same pixels"; this answers "are these the same scene". The
		 * Kismis/Lorong reuse — a crop of one ceiling re-submitted from a different phone — sits at
		 * 116 bits of PDQ distance while unrelated pairs bottom out at 88, so no perceptual band can
		 * separate them. `perceptual_embedding` stays for the strict `visual_duplicate` net.
		 */
		readonly record_embedding?: readonly number[] | null;
	}>;
	/**
	 * Photographs from OTHER assignments retrieved against this assignment's own representative
	 * photos by perceptual proximity. Nominations only — the inference judges whether a candidate
	 * is the same scene reused, which the deterministic flags alone cannot decide for crops.
	 */
	readonly candidates: ReadonlyArray<{
		readonly id: string;
		readonly photo: {
			readonly storage_key: string;
			readonly file_name: string;
			readonly file_size: number;
			readonly mime_type: string;
		};
		readonly sha256: string;
		readonly flags: ReadonlyArray<string>;
		readonly distance: number;
		readonly matched_photo_ids: ReadonlyArray<string>;
	}>;
	readonly communications: ReadonlyArray<{
		readonly source_message_id: string;
		readonly sender: string;
		readonly sent_at: string;
		readonly message: string;
	}>;
};

export function shouldReviewAssignment(
	_status: string | null,
	checkedAt: string | null = null
): boolean {
	return checkedAt === null;
}

/**
 * Materialise the unchecked worklist before reviewing it. Reviews stamp rows as they succeed, so
 * paging while processing would make the worklist shrink and skip assignments.
 */
export function loadUncheckedAssignments(api: Api, assignmentId?: string) {
	const columns = {
		id: true,
		job_id: true,
		status: true,
		summary: true,
		location: true,
		suspicion_checked_at: true
	} as const;
	return Effect.gen(function* () {
		if (assignmentId != null) {
			return yield* api.db.job_assignments.findMany({
				where: {
					id: { eq: assignmentId },
					suspicion_checked_at: { isNull: true }
				},
				columns,
				limit: 1
			});
		}

		const assignments: Array<SuspicionReviewFacts['assignment']> = [];
		let afterId: string | undefined;
		for (;;) {
			const page = yield* api.db.job_assignments.findMany({
				where:
					afterId === undefined
						? { suspicion_checked_at: { isNull: true } }
						: {
								id: { gt: afterId },
								suspicion_checked_at: { isNull: true }
							},
				columns,
				orderBy: { id: 'asc' },
				limit: ASSIGNMENT_PAGE_SIZE
			});
			let nextAfterId = afterId;
			for (const assignment of page) {
				if (nextAfterId !== undefined && assignment.id <= nextAfterId) {
					return yield* Effect.fail(
						new Error(
							`Unchecked assignment pagination did not advance beyond ${nextAfterId}; received ${assignment.id}.`
						)
					);
				}
				nextAfterId = assignment.id;
			}
			assignments.push(...page);
			if (page.length < ASSIGNMENT_PAGE_SIZE) return assignments;
			if (nextAfterId === undefined) return assignments;
			afterId = nextAfterId;
		}
	});
}

/** Canonical facts only: flags and similarities remain evidence and never become a verdict here. */
export function buildSuspicionReviewBasis(facts: SuspicionReviewFacts): string {
	return JSON.stringify({
		assignment: facts.assignment,
		job: facts.job,
		site: facts.site,
		photos: [...facts.photos]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((photo) => ({
				id: photo.id,
				storage_key: photo.photo.storage_key,
				sha256: photo.sha256,
				flags: [...photo.flags].sort(),
				matched_evidence_ids: [...photo.matched_evidence_ids].sort(),
				created_at: photo.created_at
			})),
		candidates: [...facts.candidates]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((candidate) => ({
				id: candidate.id,
				storage_key: candidate.photo.storage_key,
				sha256: candidate.sha256,
				flags: [...candidate.flags].sort(),
				distance: candidate.distance,
				matched_photo_ids: [...candidate.matched_photo_ids].sort()
			})),
		communications: [...facts.communications]
			.sort((left, right) => left.source_message_id.localeCompare(right.source_message_id))
			.map((communication) => ({
				source_message_id: communication.source_message_id,
				sender: communication.sender,
				sent_at: communication.sent_at,
				message: communication.message
			}))
	});
}

export function suspicionReviewHash(basis: string): string {
	// Authored automation modules are bundled for Colony's portable runtime, where Node built-ins
	// are intentionally unavailable. Hash the canonical basis with std's runtime-neutral SHA-256.
	return sha256Text(basis);
}

export function reviewSourceKey(assignmentId: string, basisHash: string): string {
	return `suspicion-review:${assignmentId}:${basisHash}`;
}

export function shouldCreateSuspicionLog<Decision extends { readonly suspicious: boolean }>(
	decision: Decision
): boolean {
	return decision.suspicious;
}

const clipText = (value: string, maximum: number): string =>
	value.length <= maximum ? value : `${value.slice(0, maximum - 12)}…[clipped]`;

const inferenceAssetName = (fileName: string): string =>
	clipText(fileName, MAX_INFERENCE_ASSET_NAME_CHARS);

export function validDecisionEvidenceId(
	decision: JobSiteDecision,
	photos: SuspicionReviewFacts['photos']
): string | null {
	if (decision.evidence_asset_name == null) return null;
	return (
		photos.find(
			(photo) => inferenceAssetName(photo.photo.file_name) === decision.evidence_asset_name
		)?.id ?? null
	);
}

const boundedJsonValue = (value: unknown, maximum: number): unknown => {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) return null;
	return encoded.length <= maximum ? value : clipText(encoded, maximum);
};

type GpsMetadataStatus =
	| 'missing_from_asset'
	| 'present_and_outside_assigned_site_tolerance'
	| 'present_without_location_mismatch';

/**
 * State only what the ingestion pipeline durably retained about GPS metadata.
 *
 * Raw capture coordinates are deliberately not invented here: the photo row retains the exact
 * integrity outcome (`missing_geolocation` / `location_mismatch`), not the EXIF coordinate tuple.
 */
const gpsMetadataStatusFromFlags = (flags: ReadonlyArray<string>): GpsMetadataStatus => {
	if (flags.includes('missing_geolocation')) return 'missing_from_asset';
	if (flags.includes('location_mismatch')) {
		return 'present_and_outside_assigned_site_tolerance';
	}
	return 'present_without_location_mismatch';
};

export const gpsMetadataStatus = (
	photo: SuspicionReviewFacts['photos'][number]
): GpsMetadataStatus => gpsMetadataStatusFromFlags(photo.flags);

const namedPhotoFact = (
	photo: SuspicionReviewFacts['photos'][number],
	visuallyAttached: boolean
) => ({
	asset_name: inferenceAssetName(photo.photo.file_name),
	gps_metadata: gpsMetadataStatus(photo),
	visually_attached: visuallyAttached,
	file_size: photo.photo.file_size,
	mime_type: photo.photo.mime_type,
	integrity_flags: [...photo.flags].sort()
});

const photoOrder = (photo: SuspicionReviewFacts['photos'][number]): string =>
	`${photo.created_at ?? ''}\u0000${photo.id}`;

const photoSignal = (photo: SuspicionReviewFacts['photos'][number]): number =>
	photo.matched_evidence_ids.length * 8 +
	photo.flags.reduce(
		(total, flag) =>
			total +
			(Object.hasOwn(REVIEW_SIGNAL_WEIGHT, flag)
				? REVIEW_SIGNAL_WEIGHT[flag as keyof typeof REVIEW_SIGNAL_WEIGHT]
				: 0),
		0
	);

/**
 * Pick a small, deterministic visual sample without reading every file into the inference turn.
 * Concrete integrity signals get up to two slots; the remaining slots preserve temporal coverage.
 * Oversized files remain represented in the aggregate facts but do not consume the image budget.
 */
export function selectSuspicionInferencePhotos(
	photos: SuspicionReviewFacts['photos'],
	preferredPhotoIds: ReadonlyArray<string> = []
): SuspicionReviewFacts['photos'] {
	const chronological = [...photos].sort((left, right) =>
		photoOrder(left).localeCompare(photoOrder(right))
	);
	const photoById = new Map(chronological.map((photo) => [photo.id, photo]));
	const preferred = preferredPhotoIds.flatMap((id) => {
		const photo = photoById.get(id);
		return photo === undefined ? [] : [photo];
	});
	// Duplicate reuse only signals when the identical file belongs to a *different* assignment:
	// the upload integrity hook encodes that as exact_duplicate/visual_duplicate flags and their
	// matched_evidence_ids, all of which photoSignal already counts. Identical rows within this
	// one assignment are a neutral repeat, not evidence.
	const signalled = chronological.filter((photo) => photoSignal(photo) > 0);
	signalled.sort(
		(left, right) =>
			photoSignal(right) - photoSignal(left) || photoOrder(left).localeCompare(photoOrder(right))
	);
	const signalCandidates = signalled.slice(0, MAX_SIGNAL_IMAGES);
	const temporalCandidates =
		chronological.length === 0
			? []
			: [
					chronological[0],
					chronological[Math.floor((chronological.length - 1) / 2)],
					chronological[chronological.length - 1]
				];
	const candidates = [...preferred, ...signalCandidates, ...temporalCandidates, ...chronological];
	const selected: Array<SuspicionReviewFacts['photos'][number]> = [];
	const selectedIds = new Set<string>();
	let selectedBytes = 0;
	for (const photo of candidates) {
		if (selected.length === MAX_INFERENCE_IMAGES) break;
		if (selectedIds.has(photo.id)) continue;
		if (
			photo.photo.file_size < 0 ||
			selectedBytes + photo.photo.file_size > MAX_INFERENCE_IMAGE_BYTES
		) {
			continue;
		}
		selected.push(photo);
		selectedIds.add(photo.id);
		selectedBytes += photo.photo.file_size;
	}
	return selected.sort((left, right) => photoOrder(left).localeCompare(photoOrder(right)));
}

/**
 * Candidate retrieval is cheaper than visual inference and must not inherit its three-image cap.
 * Search every ordinary assignment photo; only exceptionally large records are sampled uniformly
 * so one pathological upload cannot issue thousands of vector queries in a single review.
 */
const selectCrossAssignmentProbePhotos = (
	photos: SuspicionReviewFacts['photos']
): SuspicionReviewFacts['photos'] => {
	const chronological = [...photos].sort((left, right) =>
		photoOrder(left).localeCompare(photoOrder(right))
	);
	if (chronological.length <= MAX_CROSS_ASSIGNMENT_PROBES) return chronological;
	return Array.from({ length: MAX_CROSS_ASSIGNMENT_PROBES }, (_, index) => {
		const position = Math.round(
			(index * (chronological.length - 1)) / (MAX_CROSS_ASSIGNMENT_PROBES - 1)
		);
		return chronological[position]!;
	});
};

/** One `findNearest` hit for a probe photo, before assignment filtering and capping. */
interface CandidateHit {
	readonly id: string;
	readonly photo: SuspicionReviewFacts['photos'][number]['photo'];
	readonly sha256: string;
	readonly flags: ReadonlyArray<string>;
	readonly job_assignment_id: string | null;
	readonly variation_request_id: string | null;
	readonly distance: number;
	readonly record_embedding: readonly number[] | null;
}

/**
 * How far apart two record embeddings may sit and still be worth a look.
 *
 * Cosine, not L2: the embedding model returns unnormalised vectors, so magnitude carries no meaning
 * across records and only the angle does. 0.35 is the starting band — wide enough to nominate a crop
 * of the same scene, narrow enough that the vision step is not asked to adjudicate the whole corpus.
 * It is a retrieval band, never a verdict: `MAX_CROSS_ASSIGNMENT_CANDIDATES` survive it and the
 * inference decides whether two photographs actually show the same place.
 */
const RECORD_EMBEDDING_MAX_COSINE = 0.35;

/**
 * A reusable scene must be a distinctive nearest neighbour, not merely one member of a dense
 * cluster of common trade fixtures.
 *
 * The real BCA corpus pins the boundary: Kismis `00003140` selects Lorong `00003592` with a
 * 0.038659 gap to its runner-up. The false door/handrail match `00003149` → `00003288` has a
 * 0.001896 gap because several ordinary doors look interchangeable to the embedding. Requiring a
 * two-point cosine margin keeps candidate retrieval conservative while leaving the final visual
 * judgement to the model.
 */
export const RECORD_EMBEDDING_MIN_DISTINCTIVENESS = 0.02;

/** Angular distance in the same units `findNearest` sorted by, so a recomputed figure is comparable. */
const cosineDistance = (left: readonly number[], right: readonly number[]): number => {
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	const magnitude = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
	return magnitude === 0 ? 1 : 1 - dot / magnitude;
};

/**
 * Retrieve photographs from OTHER assignments that sit close to this assignment's representative
 * photos in perceptual space.
 *
 * The wide band exists to nominate crop/zoom/recompression reuse the strict `visual_duplicate`
 * bar misses; same-assignment hits and parentless rows are dropped, distances are recomputed from
 * the durable embeddings so the audit basis is stable, and only the closest
 * `MAX_CROSS_ASSIGNMENT_CANDIDATES` survive.
 */
export function loadCrossAssignmentCandidates(
	api: Api,
	ownAssignmentId: string,
	probes: SuspicionReviewFacts['photos']
): Effect.Effect<SuspicionReviewFacts['candidates'], unknown, never> {
	return Effect.gen(function* () {
		const probeRows = selectCrossAssignmentProbePhotos(probes);
		const hits = new Map<string, { row: CandidateHit; matched: Map<string, number> }>();
		for (const probe of probeRows) {
			// `photos` declares the embedding optional, so a probe without one is skipped rather than
			// searched: `findNearest` needs a vector, and passing an absent one would either widen the
			// facts type into a lie or search on `undefined`. The column is `notNull()`, so this is a
			// type-level possibility rather than a row anyone will see — but the loop must still say
			// which it does. Copied because the query takes a mutable array and the facts are readonly.
			const embedding = probe.record_embedding;
			// A row whose embedding has not been written yet cannot be probed with. That is an ordinary
			// state, not a fault: the vector is maintained best-effort, so a photograph uploaded during
			// a provider outage simply does not nominate candidates until it is filled in.
			if (embedding == null || embedding.length === 0) continue;
			const rows = (yield* api.db.photo_evidence.findNearest({
				column: 'record_embedding',
				probe: [...embedding],
				metric: 'cosine',
				maxDistance: RECORD_EMBEDDING_MAX_COSINE,
				limit: 12,
				columns: {
					id: true,
					photo: true,
					sha256: true,
					flags: true,
					job_assignment_id: true,
					variation_request_id: true,
					record_embedding: true
				}
			})) as readonly CandidateHit[];
			for (const row of rows) {
				if (row.id === probe.id) continue;
				if (row.record_embedding == null || row.record_embedding.length === 0) continue;
				const distance = cosineDistance(embedding, row.record_embedding);
				const existing = hits.get(row.id);
				if (existing != null) {
					existing.matched.set(probe.id, distance);
					continue;
				}
				hits.set(row.id, { row, matched: new Map([[probe.id, distance]]) });
			}
		}
		if (hits.size === 0) return [];
		const variationIds = [
			...new Set(
				[...hits.values()]
					.map(({ row }) => row.variation_request_id)
					.filter((id): id is string => id != null && id !== '')
			)
		];
		const assignmentByVariation =
			variationIds.length === 0
				? new Map<string, string | null>()
				: new Map(
						(yield* api.db.variation_requests.findMany({
							where: { id: { in: variationIds } },
							columns: { id: true, job_assignment_id: true },
							limit: Math.max(1, variationIds.length)
						})).map((variation) => [variation.id, variation.job_assignment_id ?? null])
					);
		const candidates = [...hits.entries()]
			.map(([id, { row, matched }]) => {
				const assignmentId =
					row.job_assignment_id != null && row.job_assignment_id !== ''
						? row.job_assignment_id
						: (assignmentByVariation.get(row.variation_request_id ?? '') ?? null);
				const rankedMatches = [...matched.entries()].sort(
					([leftId, leftDistance], [rightId, rightDistance]) =>
						leftDistance - rightDistance || leftId.localeCompare(rightId)
				);
				return {
					id,
					photo: row.photo,
					sha256: row.sha256,
					flags: row.flags,
					distance: rankedMatches[0]?.[1] ?? Number.POSITIVE_INFINITY,
					matches: new Map(rankedMatches),
					assignmentId
				};
			})
			.filter(
				(candidate) =>
					candidate.assignmentId != null &&
					candidate.assignmentId !== '' &&
					candidate.assignmentId !== ownAssignmentId
			);

		/**
		 * Nominate at most one foreign photo for each own photo, and only when it wins by a useful
		 * margin. The old global sort admitted several nearly tied doors from one probe before the
		 * distinctive ceiling match from another probe. It also retained every in-band probe id on a
		 * candidate while displaying only the candidate's best distance, which made weak pairs look as
		 * strong as the best one. One exact winning pair keeps the visual turn and audit UI honest.
		 */
		const nominations = new Map<string, (typeof candidates)[number] & { probeId: string }>();
		for (const probe of probeRows) {
			const ranked = candidates
				.flatMap((candidate) => {
					const distance = candidate.matches.get(probe.id);
					return distance === undefined ? [] : [{ candidate, distance }];
				})
				.sort(
					(left, right) =>
						left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id)
				);
			const winner = ranked[0];
			if (winner === undefined) continue;
			const runnerUp = ranked[1];
			if (
				runnerUp !== undefined &&
				runnerUp.distance - winner.distance < RECORD_EMBEDDING_MIN_DISTINCTIVENESS
			) {
				continue;
			}
			const previous = nominations.get(winner.candidate.id);
			if (previous == null || winner.distance < previous.distance) {
				nominations.set(winner.candidate.id, {
					...winner.candidate,
					distance: winner.distance,
					probeId: probe.id
				});
			}
		}
		const selected = [...nominations.values()];
		selected.sort(
			(left, right) => left.distance - right.distance || left.id.localeCompare(right.id)
		);
		return selected.slice(0, MAX_CROSS_ASSIGNMENT_CANDIDATES).map((candidate) => ({
			id: candidate.id,
			photo: candidate.photo,
			sha256: candidate.sha256,
			flags: candidate.flags,
			distance: Math.round(candidate.distance * 1000) / 1000,
			matched_photo_ids: [candidate.probeId]
		}));
	});
}

const communicationInstant = (
	communication: SuspicionReviewFacts['communications'][number]
): string => communication.sent_at;

type SimilarPhotoPair = {
	readonly currentPhoto: SuspicionReviewFacts['photos'][number];
	readonly candidate: SuspicionReviewFacts['candidates'][number];
	readonly visuallyAttached: boolean;
};

/**
 * Resolve every nominated foreign photo to the exact job-site asset it was retrieved against.
 * Only pairs whose two images fit this single turn's attachment budget are visually adjudicated;
 * every nomination is still named in the context so the model is never given an unexplained image.
 */
const similarPhotoPairs = (
	facts: SuspicionReviewFacts,
	representativePhotos: SuspicionReviewFacts['photos']
): ReadonlyArray<SimilarPhotoPair> => {
	const ownPhotoById = new Map(facts.photos.map((photo) => [photo.id, photo]));
	const attachedPhotoIds = new Set(representativePhotos.map((photo) => photo.id));
	return facts.candidates.flatMap((candidate) => {
		const currentPhoto = candidate.matched_photo_ids
			.map((photoId) => ownPhotoById.get(photoId))
			.find((photo) => photo !== undefined);
		if (currentPhoto === undefined) return [];
		return [
			{
				currentPhoto,
				candidate,
				visuallyAttached:
					attachedPhotoIds.has(currentPhoto.id) &&
					candidate.photo.file_size >= 0 &&
					candidate.photo.file_size <= MAX_CANDIDATE_IMAGE_BYTES
			}
		];
	});
};

/** Provider-bounded facts derived from the complete durable basis used for idempotency and audit. */
export function buildSuspicionInferenceContext(
	facts: SuspicionReviewFacts,
	representativePhotos = selectSuspicionInferencePhotos(facts.photos)
): string {
	const flagCounts = Object.fromEntries(
		PHOTO_FLAGS.map((flag) => [
			flag,
			facts.photos.reduce((count, photo) => count + Number(photo.flags.includes(flag)), 0)
		]).filter(([, count]) => count !== 0)
	);
	const attachedPhotoIds = new Set(representativePhotos.map((photo) => photo.id));
	const nominatedPairs = similarPhotoPairs(facts, representativePhotos);
	const attachedPairs = nominatedPairs.filter(({ visuallyAttached }) => visuallyAttached);
	const namedDataset = [...facts.photos]
		.sort((left, right) => photoOrder(left).localeCompare(photoOrder(right)))
		.map((photo) => namedPhotoFact(photo, attachedPhotoIds.has(photo.id)));
	const chronologicalCommunications = [...facts.communications];
	chronologicalCommunications.sort(
		(left, right) =>
			communicationInstant(left).localeCompare(communicationInstant(right)) ||
			left.source_message_id.localeCompare(right.source_message_id)
	);
	const recentCommunications = chronologicalCommunications
		.slice(-MAX_INFERENCE_COMMUNICATIONS)
		.map((communication) => ({
			source_message_id: clipText(communication.source_message_id, 256),
			sender: clipText(communication.sender, 256),
			sent_at: communicationInstant(communication),
			message: clipText(communication.message, MAX_INFERENCE_MESSAGE_CHARS)
		}));
	const base = {
		review_scope: {
			kind: 'single_assignment_review',
			instruction:
				'Complete both named tasks in this one turn. job_site_review uses only job_site_photo assets. similar_photo_reviews compares only each explicitly named pair.'
		},
		attachment_manifest: {
			instruction:
				'The attached images appear in exactly this order. The role and asset_name are authoritative; use no other image identifier.',
			images: [
				...representativePhotos.map((photo) => ({
					asset_name: inferenceAssetName(photo.photo.file_name),
					gps_metadata: gpsMetadataStatus(photo),
					role: 'job_site_photo' as const
				})),
				...attachedPairs.map(({ currentPhoto, candidate }) => ({
					asset_name: inferenceAssetName(candidate.photo.file_name),
					gps_metadata: gpsMetadataStatusFromFlags(candidate.flags),
					role: 'similar_photo_from_other_assignment' as const,
					compare_only_with_asset_name: inferenceAssetName(currentPhoto.photo.file_name)
				}))
			]
		},
		assignment: {
			...facts.assignment,
			summary: facts.assignment.summary == null ? null : clipText(facts.assignment.summary, 1_600),
			location: boundedJsonValue(facts.assignment.location, 1_600)
		},
		job:
			facts.job == null
				? null
				: {
						...facts.job,
						title: clipText(facts.job.title, 512),
						nature: facts.job.nature == null ? null : clipText(facts.job.nature, 512),
						description: clipText(facts.job.description, 4_000)
					},
		site:
			facts.site == null
				? null
				: {
						...facts.site,
						name: clipText(facts.site.name, 512),
						location: boundedJsonValue(facts.site.location, 1_600),
						house_type: facts.site.house_type == null ? null : clipText(facts.site.house_type, 512)
					},
		photo_summary: {
			total: facts.photos.length,
			attached_representatives: representativePhotos.length,
			omitted_from_visual_turn: facts.photos.length - representativePhotos.length,
			flag_counts: flagCounts,
			similarity_relationships: facts.photos.reduce(
				(count, photo) => count + photo.matched_evidence_ids.length,
				0
			),
			job_site_photo_dataset: namedDataset
		},
		similar_photos_flagged: nominatedPairs.map(({ currentPhoto, candidate, visuallyAttached }) => ({
			job_site_asset_name: inferenceAssetName(currentPhoto.photo.file_name),
			similar_asset_name: inferenceAssetName(candidate.photo.file_name),
			similar_asset_gps_metadata: gpsMetadataStatusFromFlags(candidate.flags),
			retrieval_distance: candidate.distance,
			visually_attached: visuallyAttached
		}))
	};
	let communications = recentCommunications;
	for (;;) {
		const context = {
			...base,
			communication_summary: {
				total: facts.communications.length,
				included_recent: communications.length,
				omitted: facts.communications.length - communications.length,
				messages: communications
			}
		};
		const encoded = JSON.stringify(context);
		if (encoded.length <= MAX_INFERENCE_CONTEXT_CHARS || communications.length === 0) {
			return encoded;
		}
		communications = communications.slice(1);
	}
}

export function suspicionPrompt(
	facts: SuspicionReviewFacts,
	representativePhotos = selectSuspicionInferencePhotos(facts.photos)
): string {
	const attachedPairCount = similarPhotoPairs(facts, representativePhotos).filter(
		({ visuallyAttached }) => visuallyAttached
	).length;
	return [
		'Review this field-work assignment in exactly one structured turn. Return one job_site_review and one similar_photo_reviews entry for every visually attached named pair.',
		'The attachment_manifest is authoritative: it names every attached image in order and identifies whether it is a job_site_photo or a similar_photo_from_other_assignment. Refer to an image only by its exact asset_name. Do not invent a photo number, record id, attachment label, address, GPS coordinate, or any other identification method.',
		'TASK 1 — job_site_review. Judge only the assets whose role is job_site_photo. Never treat a similar_photo_from_other_assignment as evidence that a second site was submitted to this assignment, and never borrow a number, address, sign, marker or scene observation from it.',
		'The job_site_photo_dataset is the complete set submitted to this assignment. Each row gives the actual asset_name and the GPS metadata state durably retained by ingestion.',
		representativePhotos.length === 0
			? 'No photo fit the bounded attachment budget. Judge from the assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications; do not pretend a scene was visible.'
			: `The attachment_manifest names the ${representativePhotos.length} job-site photo${representativePhotos.length === 1 ? '' : 's'} actually attached for visual review. Photos marked visually_attached false are listed for completeness but were not visible; never claim to have read a marker from one of them.`,
		'The durable audit basis covers every photo and communication; this inference context is deliberately bounded and states what was omitted.',
		'Missing photo geolocation is a neutral fact because messaging services commonly strip metadata.',
		'Visual similarity inside one assignment is a neutral fact because legitimate repeated views are possible.',
		'Use only physical scene markers visibly present in an attached job-site photo, such as door plates, house numbers, street or building signs, mailboxes, lobby signs and lift permits, when assessing location. Ignore uploader-controlled timestamp, GPS and address overlays, work labels, tape measures, tag numbers, bin or lamppost ids and telephone numbers.',
		'Duplicate reuse only matters between distinct assignments: an identical file submitted under the same assignment is a neutral repeat, never evidence.',
		'Raise an unresolved mixed-sites suspicion only when two or more attached job-site photos contain concrete physical markers for conflicting sites. Different-looking rooms, fixtures, exterior views, or common trade features alone do not establish multiple sites.',
		'A suspicion log is an actionable escalation, not a queue for low-confidence review. Plausibly benign ambiguity, incomplete corroboration, or the fact that a controller could confirm something is not enough. When the available evidence has a reasonable ordinary explanation and no concrete contradiction, return suspicious false.',
		'For every other fact, return suspicious only when your contextual judgement finds a concrete, articulable reason to question this assignment.',
		'Likewise, an assignment location mismatch is evidence for judgement, never an automatic verdict.',
		`If job_site_review.suspicious is true, give a concise reason of at most ${MAX_INFERENCE_REASON_CHARS} characters that a controller can investigate. Set evidence_asset_name to the exact asset_name of one decisive attached job-site photo and reference only exact asset names from the supplied dataset in the reason.`,
		`If job_site_review.suspicious is false, set evidence_asset_name to null and explain in at most ${MAX_INFERENCE_REASON_CHARS} characters why the evidence does not justify a log.`,
		'TASK 2 — similar_photo_reviews. The similar_photos_flagged list contains retrieval nominations from other assignments. Retrieval distance is not evidence. Compare each visually_attached pair only with its named job_site_asset_name; do not compare it to another job-site photo and do not use it in TASK 1.',
		'Return same_scene true only when multiple permanent visual landmarks share the same geometry: for example the same openings, vents, holes, stains, wall or ceiling edges, fixed fixtures and background structure in the same relative positions.',
		'A crop, zoom, recompression, new overlay, different timestamp, different camera, or re-photograph of the same underlying scene is still same_scene true. Overlay text must neither establish nor rebut the match.',
		'Similar colours, doors, handrails, grab bars, stairs, bathrooms, ceilings or trade fixtures without distinctive shared geometry are expected across unrelated sites and must return same_scene false. If uncertain, return same_scene false.',
		`Return exactly ${attachedPairCount} similar_photo_reviews entr${attachedPairCount === 1 ? 'y' : 'ies'}: one for each pair marked visually_attached true, using its exact job_site_asset_name and similar_asset_name. Return no entry for a pair marked visually_attached false and never introduce another asset name.`,
		`Bounded inference facts: ${buildSuspicionInferenceContext(facts, representativePhotos)}`
	].join(' ');
}

/**
 * Complete the assignment consistency review and all visually attached similar-photo comparisons
 * in one provider turn. Runtime validation accepts pair decisions only when both returned asset
 * names match the authoritative manifest exactly; model pair prose never enters the durable log.
 */
export function inferSuspicionReviewDecision(
	api: Api,
	facts: SuspicionReviewFacts,
	representativePhotos = selectSuspicionInferencePhotos(facts.photos)
) {
	return Effect.gen(function* () {
		const attachedPairs = similarPhotoPairs(facts, representativePhotos).filter(
			({ visuallyAttached }) => visuallyAttached
		);
		const decision = yield* api.infer({
			model: SUSPICION_REVIEW_MODEL,
			schema: suspicionInferenceSchema,
			images: [
				...representativePhotos.map((photo) => ({
					file: photo.photo,
					detail: 'high' as const
				})),
				...attachedPairs.map(({ candidate }) => ({
					file: candidate.photo,
					detail: 'high' as const
				}))
			],
			prompt: suspicionPrompt(facts, representativePhotos)
		});

		const expectedPairs = new Map(
			attachedPairs.map((pair) => [
				JSON.stringify([
					inferenceAssetName(pair.currentPhoto.photo.file_name),
					inferenceAssetName(pair.candidate.photo.file_name)
				]),
				pair
			])
		);
		const reviewedPairs = new Map<string, (typeof attachedPairs)[number]>();
		const confirmedReuse: Array<(typeof attachedPairs)[number]> = [];
		for (const review of decision.similar_photo_reviews) {
			const key = JSON.stringify([review.job_site_asset_name, review.similar_asset_name]);
			const pair = expectedPairs.get(key);
			if (pair === undefined || reviewedPairs.has(key)) {
				return yield* Effect.fail(
					new Error(
						'Suspicion review returned an unnamed, unexpected, or duplicate similar-photo pair.'
					)
				);
			}
			reviewedPairs.set(key, pair);
			if (review.same_scene) confirmedReuse.push(pair);
		}
		if (reviewedPairs.size !== expectedPairs.size) {
			return yield* Effect.fail(
				new Error(
					`Suspicion review returned ${reviewedPairs.size} of ${expectedPairs.size} required similar-photo pair decisions.`
				)
			);
		}
		const reuseReasons = confirmedReuse.map(
			({ currentPhoto, candidate }) =>
				`Cross-assignment photo reuse: ${inferenceAssetName(currentPhoto.photo.file_name)} and ${inferenceAssetName(candidate.photo.file_name)} were judged to show the same physical scene.`
		);
		const assignmentDecision = decision.job_site_review;
		const assignmentEvidenceId = validDecisionEvidenceId(assignmentDecision, representativePhotos);
		const supportedAssignmentSuspicion =
			assignmentDecision.suspicious && assignmentEvidenceId !== null;
		const unsupportedAssignmentSuspicion =
			assignmentDecision.suspicious && assignmentEvidenceId === null;
		const suspicious = supportedAssignmentSuspicion || confirmedReuse.length > 0;
		const reason = clipText(
			[
				...(supportedAssignmentSuspicion ? [assignmentDecision.reason] : []),
				...reuseReasons,
				...(!suspicious && unsupportedAssignmentSuspicion
					? [
							'No suspicion log was created because the review did not identify an attached job-site asset by its supplied name.'
						]
					: []),
				...(!suspicious && !unsupportedAssignmentSuspicion ? [assignmentDecision.reason] : [])
			].join(' '),
			MAX_INFERENCE_REASON_CHARS
		);
		const evidenceId = supportedAssignmentSuspicion
			? assignmentEvidenceId
			: (confirmedReuse[0]?.currentPhoto.id ?? null);
		return { suspicious, reason, evidence_id: evidenceId };
	});
}

function loadFacts(api: Api, assignment: SuspicionReviewFacts['assignment']) {
	return Effect.gen(function* () {
		const job = yield* api.db.jobs.findFirst({
			where: { id: { eq: assignment.job_id } },
			columns: {
				id: true,
				site_id: true,
				title: true,
				nature: true,
				scheduled_for: true,
				description: true
			}
		});
		const site =
			job == null
				? null
				: ((yield* api.db.sites.findFirst({
						where: { id: { eq: job.site_id } },
						columns: { id: true, name: true, location: true, house_type: true }
					})) ?? null);
		const variations = yield* api.db.variation_requests.findMany({
			where: { job_assignment_id: { eq: assignment.id } },
			columns: { id: true },
			limit: MAX_RELATED_ROWS
		});
		const variationIds = variations.map((variation) => variation.id);
		const photos = yield* api.db.photo_evidence.findMany({
			where:
				variationIds.length === 0
					? { job_assignment_id: { eq: assignment.id } }
					: {
							OR: [
								{ job_assignment_id: { eq: assignment.id } },
								{ variation_request_id: { in: variationIds } }
							]
						},
			columns: {
				id: true,
				photo: true,
				sha256: true,
				flags: true,
				matched_evidence_ids: true,
				created_at: true,
				perceptual_embedding: true,
				record_embedding: true
			},
			limit: MAX_RELATED_ROWS
		});
		const communications = yield* api.db.communication_logs.findMany({
			where: { job_assignment_id: { eq: assignment.id } },
			columns: {
				source_message_id: true,
				sender: true,
				sent_at: true,
				message: true
			},
			limit: MAX_RELATED_ROWS
		});
		return {
			assignment,
			job:
				job == null
					? null
					: {
							id: job.id,
							title: job.title,
							nature: job.nature,
							scheduled_for: job.scheduled_for,
							description: job.description
						},
			site,
			photos,
			// Candidates are retrieved against the selected representatives only, after this load.
			candidates: [],
			communications
		} satisfies SuspicionReviewFacts;
	});
}

type SuspicionReviewResult =
	| { readonly status: 'skipped_checked' }
	| { readonly status: 'clear'; readonly review_id: string }
	| { readonly status: 'clear_existing'; readonly review_id: string }
	| { readonly status: 'suspicious'; readonly review_id: string; readonly log_id: string }
	| {
			readonly status: 'suspicious_open_exists';
			readonly review_id: string;
			readonly log_id: string;
	  }
	| {
			readonly status: 'suspicious_log_exists';
			readonly review_id: string;
			readonly log_id: string;
	  };

type SuspicionReviewLifecycle = Readonly<{
	readonly inferenceStarted?: (assignmentId: string) => void;
	readonly inferenceSucceeded?: (assignmentId: string) => void;
	readonly reviewPersisted?: (assignmentId: string) => void;
}>;

export function reviewAssignmentSuspicion(
	api: Api,
	assignment: SuspicionReviewFacts['assignment'],
	lifecycle: SuspicionReviewLifecycle = {}
): Effect.Effect<SuspicionReviewResult, unknown, never> {
	return Effect.gen(function* () {
		if (!shouldReviewAssignment(assignment.status, assignment.suspicion_checked_at ?? null))
			return { status: 'skipped_checked' as const };

		const loadedFacts = yield* loadFacts(api, assignment);
		const candidates = yield* loadCrossAssignmentCandidates(api, assignment.id, loadedFacts.photos);
		const representativePhotos = selectSuspicionInferencePhotos(
			loadedFacts.photos,
			candidates.flatMap((candidate) => candidate.matched_photo_ids)
		);
		const facts: SuspicionReviewFacts = { ...loadedFacts, candidates };
		const basis = buildSuspicionReviewBasis(facts);
		const basisHash = suspicionReviewHash(basis);
		lifecycle.inferenceStarted?.(assignment.id);
		const decision = yield* inferSuspicionReviewDecision(api, facts, representativePhotos);
		lifecycle.inferenceSucceeded?.(assignment.id);
		const reviewedAt = (yield* currentDate).toISOString();
		/**
		 * Write, then read the judgement back by the key that makes it unique.
		 *
		 * `mutate` answers with nothing, so the row this wrote is found the same way a row an earlier
		 * attempt wrote is found: `(job_assignment_id, basis_hash)` identifies exactly one review. The
		 * write is allowed to fail for that reason — a concurrent attempt won the unique index — and
		 * the read below then returns the winner's row, which is the same answer this call would have
		 * produced. A read that finds nothing after either outcome is a real failure, not a race.
		 */
		const reviewIdentity = {
			where: {
				job_assignment_id: { eq: assignment.id },
				basis_hash: { eq: basisHash }
			},
			columns: {
				id: true,
				basis: true,
				suspicious: true,
				reason: true,
				evidence_id: true
			}
		} as const;
		let persistenceError: unknown;
		const created = yield* api.db.suspicion_reviews
			.mutate({
				job_assignment_id: assignment.id,
				basis_hash: basisHash,
				basis,
				suspicious: decision.suspicious,
				reason: decision.reason,
				evidence_id: decision.evidence_id,
				model: SUSPICION_REVIEW_MODEL,
				reviewed_at: reviewedAt,
				source_key: reviewSourceKey(assignment.id, basisHash)
			})
			.pipe(
				Effect.as(true as const),
				Effect.catch((error: unknown) =>
					Effect.sync(() => {
						persistenceError = error;
						return false as const;
					})
				)
			);
		const review = yield* api.db.suspicion_reviews.findFirst(reviewIdentity);
		if (review == null) {
			return yield* Effect.fail(
				persistenceError ??
					new Error(
						'The suspicion review was written but could not be read back by its basis hash.'
					)
			);
		}
		lifecycle.reviewPersisted?.(assignment.id);
		const persistedDecision = created
			? {
					basis,
					suspicious: decision.suspicious,
					reason: decision.reason,
					evidence_id: decision.evidence_id
				}
			: review;
		if (!persistedDecision.suspicious) {
			return {
				status: created ? ('clear' as const) : ('clear_existing' as const),
				review_id: review.id
			};
		}

		// Inference is external I/O. Re-read the durable judgements after it completes so retries and a
		// controller action during the call cannot create a duplicate suspicion log.
		const [reviewLog, newlyOpen] = yield* Effect.all(
			[
				api.db.suspicious_activity_logs.findFirst({
					where: { review_id: { eq: review.id } },
					columns: { id: true }
				}),
				api.db.suspicious_activity_logs.findFirst({
					where: {
						job_assignment_id: { eq: assignment.id },
						resolved_at: { isNull: true }
					},
					columns: { id: true }
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (reviewLog != null) {
			return {
				status: 'suspicious_log_exists' as const,
				review_id: review.id,
				log_id: reviewLog.id
			};
		}
		if (newlyOpen != null) {
			return {
				status: 'suspicious_open_exists' as const,
				review_id: review.id,
				log_id: newlyOpen.id
			};
		}

		yield* api.db.suspicious_activity_logs.mutate({
			job_assignment_id: assignment.id,
			origin: 'automation',
			basis: persistedDecision.basis,
			review_id: review.id,
			evidence_id: persistedDecision.evidence_id,
			reason: persistedDecision.reason
		});
		// One log per review, which is the query two branches above already rely on to decide that a
		// log exists — so it is also how the log just written is identified.
		const log = yield* api.db.suspicious_activity_logs.findFirst({
			where: { review_id: { eq: review.id } },
			columns: { id: true }
		});
		if (log == null) {
			return yield* Effect.fail(
				new Error('The suspicion log was written but could not be read back by its review id.')
			);
		}
		return { status: 'suspicious' as const, review_id: review.id, log_id: log.id };
	});
}
