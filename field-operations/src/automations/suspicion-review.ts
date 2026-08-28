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
 * paging while processing would make offset pages shrink and skip assignments.
 */
export function loadUncheckedAssignments(api: Api, assignmentId?: string) {
	const where =
		assignmentId == null
			? { suspicion_checked_at: { isNull: true } as const }
			: {
					id: { eq: assignmentId },
					suspicion_checked_at: { isNull: true } as const
				};
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
			return yield* api.db.job_assignments.findMany({ where, columns, limit: 1 });
		}

		const assignments: Array<SuspicionReviewFacts['assignment']> = [];
		let offset = 0;
		for (;;) {
			const page = yield* api.db.job_assignments.findMany({
				where,
				columns,
				orderBy: { id: 'asc' },
				limit: ASSIGNMENT_PAGE_SIZE,
				offset
			});
			assignments.push(...page);
			if (page.length < ASSIGNMENT_PAGE_SIZE) return assignments;
			offset += page.length;
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

type WithinAssignmentExactShaGroup = Readonly<{
	readonly sha256: string;
	readonly evidence_ids: ReadonlyArray<string>;
}>;

/**
 * Byte-identical evidence submitted more than once for this assignment.
 *
 * The upload integrity hook deliberately treats reuse *between* assignments as its collection-level
 * signal. Suspicion review asks a different question: whether one assignment's complete evidence
 * basis contains the same bytes under distinct evidence rows. Derive that fact from the durable
 * SHA-256 values already loaded for the review so seeded rows and live uploads have identical
 * semantics without rewriting either source.
 */
export function withinAssignmentExactShaGroups(
	photos: SuspicionReviewFacts['photos']
): ReadonlyArray<WithinAssignmentExactShaGroup> {
	const evidenceIdsBySha = new Map<string, Array<string>>();
	for (const photo of [...photos].sort((left, right) =>
		photoOrder(left).localeCompare(photoOrder(right))
	)) {
		const evidenceIds = evidenceIdsBySha.get(photo.sha256);
		if (evidenceIds === undefined) evidenceIdsBySha.set(photo.sha256, [photo.id]);
		else evidenceIds.push(photo.id);
	}
	return [...evidenceIdsBySha].flatMap(([sha256, evidence_ids]) =>
		evidence_ids.length > 1 ? [{ sha256, evidence_ids }] : []
	);
}

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
	photos: SuspicionReviewFacts['photos']
): SuspicionReviewFacts['photos'] {
	const chronological = [...photos].sort((left, right) =>
		photoOrder(left).localeCompare(photoOrder(right))
	);
	const withinAssignmentExactDuplicateIds = new Set(
		withinAssignmentExactShaGroups(chronological).flatMap((group) => group.evidence_ids)
	);
	const signalled = chronological.filter(
		(photo) => withinAssignmentExactDuplicateIds.has(photo.id) || photoSignal(photo) > 0
	);
	signalled.sort(
		(left, right) =>
			Number(withinAssignmentExactDuplicateIds.has(right.id)) -
				Number(withinAssignmentExactDuplicateIds.has(left.id)) ||
			photoSignal(right) - photoSignal(left) ||
			photoOrder(left).localeCompare(photoOrder(right))
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
	const candidates = [...signalCandidates, ...temporalCandidates, ...chronological];
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

const communicationInstant = (
	communication: SuspicionReviewFacts['communications'][number]
): string => communication.sent_at;

/** Provider-bounded facts derived from the complete durable basis used for idempotency and audit. */
export function buildSuspicionInferenceContext(
	facts: SuspicionReviewFacts,
	representativePhotos = selectSuspicionInferencePhotos(facts.photos)
): string {
	const withinAssignmentExactGroups = withinAssignmentExactShaGroups(facts.photos);
	const flagCounts = Object.fromEntries(
		PHOTO_FLAGS.map((flag) => [
			flag,
			facts.photos.reduce((count, photo) => count + Number(photo.flags.includes(flag)), 0)
		]).filter(([, count]) => count !== 0)
	);
	const representatives = representativePhotos.map((photo) => ({
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
	const base = {
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
			within_assignment_exact_sha_group_count: withinAssignmentExactGroups.length,
			within_assignment_exact_sha_photo_count: withinAssignmentExactGroups.reduce(
				(count, group) => count + group.evidence_ids.length,
				0
			),
			flag_counts: flagCounts,
			similarity_relationships: facts.photos.reduce(
				(count, photo) => count + photo.matched_evidence_ids.length,
				0
			),
			representative_photos: representatives
		}
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
	return [
		'Review this field-work assignment and decide whether an unresolved suspicion should be raised.',
		representativePhotos.length === 0
			? 'No photo fit the bounded attachment budget. Judge from the assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications; do not pretend a scene was visible.'
			: `Use the ${representativePhotos.length} attached representative photographed scene${representativePhotos.length === 1 ? '' : 's'}, assigned job and site, aggregate deterministic photo facts, and bounded recent contractor communications together.`,
		'The durable audit basis covers every photo and communication; this inference context is deliberately bounded and states what was omitted.',
		'Missing photo geolocation is a neutral fact because messaging services commonly strip metadata.',
		'Visual similarity is a neutral fact because legitimate repeated views are possible.',
		'Use only physical scene markers such as door plates, house numbers, street or building signs, mailboxes, lobby signs and lift permits when assessing location. Ignore uploader-controlled timestamp, GPS and address overlays, work labels, tape measures, tag numbers, bin or lamppost ids and telephone numbers.',
		'A non-zero within_assignment_exact_sha_group_count is stronger: distinct evidence rows contain byte-identical files submitted for this one assignment. Treat that as concrete duplicate-submission evidence warranting an unresolved suspicion, identify the duplicate files in the reason, and do not claim it proves fraud.',
		'Raise an unresolved suspicion when physical scenes show multiple unexplained sites mixed into one assignment, while acknowledging any valid assigned-site evidence in the same batch.',
		'The reserved review policy also treats a concrete but plausibly benign ambiguity as suspicious when a controller is needed to resolve it: an unexplained lobby or unit range, a physical marker that corroborates only part of the assigned address, or one isolated visually different work scene among otherwise matched evidence. State the benign interpretation and ask for confirmation; do not call it fraud or a proven mismatch.',
		'For every other fact, return suspicious only when your contextual judgement finds concrete reason to question this assignment.',
		'Likewise, an assignment location mismatch is evidence for judgement, never an automatic verdict.',
		`If suspicious is true, give a concise reason of at most ${MAX_INFERENCE_REASON_CHARS} characters that a controller can investigate and cite one representative photo id when an attached photo is decisive.`,
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
				created_at: true
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

		const facts = yield* loadFacts(api, assignment);
		const basis = buildSuspicionReviewBasis(facts);
		const basisHash = suspicionReviewHash(basis);
		const representativePhotos = selectSuspicionInferencePhotos(facts.photos);
		lifecycle.inferenceStarted?.(assignment.id);
		const decision = yield* api.infer({
			model: SUSPICION_REVIEW_MODEL,
			schema: suspicionInferenceSchema,
			images: representativePhotos.map((photo) => ({
				file: photo.photo,
				detail: 'low' as const
			})),
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
				Effect.catch(() => Effect.succeed(false as const))
			);
		const review = yield* api.db.suspicion_reviews.findFirst(reviewIdentity);
		if (review == null) {
			return yield* Effect.fail(
				new Error('The suspicion review was written but could not be read back by its basis hash.')
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
