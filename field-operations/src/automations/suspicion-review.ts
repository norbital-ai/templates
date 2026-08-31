import { sha256Text } from '@norbital-ai/std/reckon/hash';
import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';
import { currentDate } from '../lib/clock.js';

// The judgement consumes photographs and a strict JSON Schema in the same turn. Keep it on a
// provider model with native support for both instead of relying on best-effort JSON wrapping.
const SUSPICION_REVIEW_MODEL = 'openai/gpt-4.1-mini';
export const ASSIGNMENT_PAGE_SIZE = 500;
const MAX_RELATED_ROWS = 5_000;
export const MAX_INFERENCE_IMAGES = 3;
export const MAX_INFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_INFERENCE_CONTEXT_CHARS = 48 * 1024;
export const MAX_INFERENCE_REASON_CHARS = 600;
export const MAX_INFERENCE_EVIDENCE_ID_CHARS = 128;
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

const inferenceDecisionSchema = Schema.Struct({
	suspicious: Schema.Boolean,
	reason: Schema.String.pipe(
		Schema.check(Schema.isPattern(/^\s*\S[\s\S]*$/)),
		Schema.check(Schema.isMaxLength(MAX_INFERENCE_REASON_CHARS))
	),
	evidence_id: Schema.NullOr(
		Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_INFERENCE_EVIDENCE_ID_CHARS)))
	)
});

export const suspicionInferenceSchema = inferenceDecisionSchema;

type SuspicionInferenceDecision = Schema.Schema.Type<typeof inferenceDecisionSchema>;

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

export function validDecisionEvidenceId(
	decision: SuspicionInferenceDecision,
	photoIds: ReadonlySet<string>
): string | null {
	return decision.evidence_id != null && photoIds.has(decision.evidence_id)
		? decision.evidence_id
		: null;
}

export function shouldCreateSuspicionLog(decision: SuspicionInferenceDecision): boolean {
	return decision.suspicious;
}

const clipText = (value: string, maximum: number): string =>
	value.length <= maximum ? value : `${value.slice(0, maximum - 12)}…[clipped]`;

const boundedJsonValue = (value: unknown, maximum: number): unknown => {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) return null;
	return encoded.length <= maximum ? value : clipText(encoded, maximum);
};

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
			distance: Math.round(candidate.distance * 1000) / 1000,
			matched_photo_ids: [candidate.probeId]
		}));
	});
}

const communicationInstant = (
	communication: SuspicionReviewFacts['communications'][number]
): string => communication.sent_at;

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
	const representatives = representativePhotos.map((photo, index) => ({
		attached_image_index: index + 1,
		id: photo.id,
		file_name: clipText(photo.photo.file_name, 256),
		file_size: photo.photo.file_size,
		mime_type: photo.photo.mime_type,
		sha256: photo.sha256,
		flags: [...photo.flags].sort(),
		matched_evidence_count: photo.matched_evidence_ids.length,
		matched_evidence_ids: [...photo.matched_evidence_ids].sort().slice(0, 12),
		created_at: photo.created_at
	}));
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
	const attachedCandidateIndex = new Map(
		facts.candidates
			.filter((candidate) => candidate.photo.file_size <= MAX_CANDIDATE_IMAGE_BYTES)
			.map((candidate, index) => [candidate.id, representatives.length + index + 1])
	);
	const attachmentManifest = [
		...representatives.map((photo) => ({
			attached_image_index: photo.attached_image_index,
			role: 'current_assignment_evidence' as const,
			photo_id: photo.id
		})),
		...facts.candidates.flatMap((candidate) => {
			const attachedImageIndex = attachedCandidateIndex.get(candidate.id);
			return attachedImageIndex === undefined
				? []
				: [
						{
							attached_image_index: attachedImageIndex,
							role: 'other_assignment_comparison_only' as const,
							candidate_id: candidate.id,
							compare_only_to_photo_id: candidate.matched_photo_ids[0] ?? null
						}
					];
		})
	];
	const base = {
		attachment_manifest: {
			current_assignment_image_count: representatives.length,
			other_assignment_comparison_image_count: attachmentManifest.length - representatives.length,
			images: attachmentManifest
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
			attached_representatives: representatives.length,
			omitted_from_visual_turn: facts.photos.length - representatives.length,
			flag_counts: flagCounts,
			similarity_relationships: facts.photos.reduce(
				(count, photo) => count + photo.matched_evidence_ids.length,
				0
			),
			representative_photos: representatives
		},
		cross_assignment_candidates: facts.candidates.map((candidate) => ({
			id: candidate.id,
			file_name: candidate.photo.file_name,
			sha256: candidate.sha256,
			distance: candidate.distance,
			matched_photo_ids: [...candidate.matched_photo_ids],
			best_match_photo_id: candidate.matched_photo_ids[0] ?? null,
			best_match_attached_image_index:
				representatives.findIndex((photo) => photo.id === candidate.matched_photo_ids[0]) + 1 ||
				null,
			attached_image_index: attachedCandidateIndex.get(candidate.id) ?? null
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
	const attachedCandidateCount = facts.candidates.filter(
		(candidate) => candidate.photo.file_size <= MAX_CANDIDATE_IMAGE_BYTES
	).length;
	const candidateRoleInstruction =
		attachedCandidateCount === 0
			? 'No foreign comparison image is attached.'
			: 'Images after the first ' +
				representativePhotos.length +
				' are ' +
				attachedCandidateCount +
				' foreign comparison image' +
				(attachedCandidateCount === 1 ? '' : 's') +
				' from OTHER assignments, not photos contained in this assignment. The attachment_manifest is authoritative about each image role. Never count a foreign comparison image as another site mixed into this assignment.';
	return [
		'Review this field-work assignment and decide whether an unresolved suspicion should be raised.',
		representativePhotos.length === 0
			? 'No photo fit the bounded attachment budget. Judge from the assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications; do not pretend a scene was visible.'
			: `Use the ${representativePhotos.length} attached representative photographed scene${representativePhotos.length === 1 ? '' : 's'}, assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications together.`,
		candidateRoleInstruction,
		'The durable audit basis covers every photo and communication; this inference context is deliberately bounded and states what was omitted.',
		'Missing photo geolocation is a neutral fact because messaging services commonly strip metadata.',
		'Visual similarity inside one assignment is a neutral fact because legitimate repeated views are possible.',
		'Use only physical scene markers such as door plates, house numbers, street or building signs, mailboxes, lobby signs and lift permits when assessing location. Ignore uploader-controlled timestamp, GPS and address overlays, work labels, tape measures, tag numbers, bin or lamppost ids and telephone numbers. In particular, text or an address overlay visible on a foreign comparison image says nothing about which photos were submitted to this assignment.',
		'Duplicate reuse only matters between distinct assignments: an identical file submitted under the same assignment is a neutral repeat, never evidence.',
		'The context may list cross_assignment_candidates: reference photographs retrieved from OTHER assignments whose learned image embedding selected one distinctive nearest neighbour. They have exactly one permitted use: compare each candidate with its best_match_photo_id and best_match_attached_image_index for possible reuse. Do not use a candidate for the general location or mixed-sites review.',
		'Embedding distance is retrieval ranking, not evidence. Similar colours, doors, handrails, grab bars, stairwells, bathrooms or other common trade fixtures are expected across unrelated installations and must be cleared even at a low distance.',
		'Reuse requires high confidence from distinctive shared scene geometry: the same spatial arrangement of permanent edges, openings, vents, holes, stains, fixtures and background structure. A lower distance never overrides visible geometric differences. If the views merely look similar or you are uncertain whether they are the same physical scene, clear the pair.',
		'If a candidate photo shows the same physical scene as the photo it was matched with \u2014 the same view cropped, zoomed, recompressed, re-photographed or re-sent \u2014 the same evidence is serving two assignments. Raise an unresolved suspicion, name both photos in the reason, and cite this assignment\u2019s photo id.',
		'A candidate showing a different unit, storey, house or street, or a plausibly distinct scene of the same trade, is not reuse; treat the pair as cleared.',
		'Raise an unresolved mixed-sites suspicion only when evidence submitted to THIS assignment contains a concrete physical marker for a conflicting site. Different-looking rooms, fixtures, or exterior views alone do not establish multiple sites.',
		'A suspicion log is an actionable escalation, not a queue for low-confidence review. Plausibly benign ambiguity, incomplete corroboration, or the fact that a controller could confirm something is not enough. When the available evidence has a reasonable ordinary explanation and no concrete contradiction, return suspicious false.',
		'For every other fact, return suspicious only when your contextual judgement finds a concrete, articulable reason to question this assignment.',
		'Likewise, an assignment location mismatch is evidence for judgement, never an automatic verdict.',
		`If suspicious is true, give a concise reason of at most ${MAX_INFERENCE_REASON_CHARS} characters that a controller can investigate and cite actual photo ids, not attachment numbers. Cite one current-assignment representative photo id when an attached photo is decisive.`,
		`If suspicious is false, explain in at most ${MAX_INFERENCE_REASON_CHARS} characters why the evidence does not justify a log.`,
		`Bounded inference facts: ${buildSuspicionInferenceContext(facts, representativePhotos)}`
	].join(' ');
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
		// Guarantee one visible own-side photo for each winning cross-assignment pair before filling
		// the remaining attachment slots with ordinary signal/temporal representatives.
		const matchedPhotoPriority = [
			...candidates.flatMap((candidate) => candidate.matched_photo_ids.slice(0, 1)),
			...candidates.flatMap((candidate) => candidate.matched_photo_ids)
		];
		const representativePhotos = selectSuspicionInferencePhotos(
			loadedFacts.photos,
			matchedPhotoPriority
		);
		const facts: SuspicionReviewFacts = { ...loadedFacts, candidates };
		const basis = buildSuspicionReviewBasis(facts);
		const basisHash = suspicionReviewHash(basis);
		const matchedPhotoIds = new Set(candidates.flatMap((candidate) => candidate.matched_photo_ids));
		lifecycle.inferenceStarted?.(assignment.id);
		const decision = yield* api.infer({
			model: SUSPICION_REVIEW_MODEL,
			schema: suspicionInferenceSchema,
			images: [
				...representativePhotos.map((photo) => ({
					file: photo.photo,
					// Reuse review depends on small permanent geometric differences. Preserve those for
					// the own side of a nominated pair; ordinary assignment context stays economical.
					detail: matchedPhotoIds.has(photo.id) ? ('high' as const) : ('low' as const)
				})),
				// Candidates follow the assignment's own photos so reuse pairs are visible in one turn;
				// oversized files stay context-only facts rather than consuming the attachment budget.
				...candidates
					.filter((candidate) => candidate.photo.file_size <= MAX_CANDIDATE_IMAGE_BYTES)
					.map((candidate) => ({
						file: candidate.photo,
						detail: 'high' as const
					}))
			],
			prompt: suspicionPrompt(facts, representativePhotos)
		});
		lifecycle.inferenceSucceeded?.(assignment.id);
		const photoIds = new Set(representativePhotos.map((photo) => photo.id));
		const evidenceId = validDecisionEvidenceId(decision, photoIds);
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
				evidence_id: evidenceId,
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
			? { basis, suspicious: decision.suspicious, reason: decision.reason, evidence_id: evidenceId }
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
