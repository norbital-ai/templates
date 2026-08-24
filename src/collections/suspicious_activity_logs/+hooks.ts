import { Effect } from 'effect';
import type { WorkspaceInsert } from '$bolt/types.js';
import type { Hooks } from './$types.js';

const immutableJudgementFields = [
	'job_assignment_id',
	'source_key',
	'origin',
	'basis',
	'review_id',
	'evidence_id',
	'reason'
] as const;

const SUSPICION_BATCH_LIMIT = 5_000;

type SuspicionCreatePrepared = {
	readonly assignmentIds: ReadonlySet<string>;
	readonly assignmentByReviewId: ReadonlyMap<string, string>;
	readonly assignmentByEvidenceId: ReadonlyMap<string, string | null>;
};

type ResolutionTuple = {
	readonly resolution?: string | null;
	readonly resolved_at?: string | null;
	readonly resolved_by?: string | null;
};

type SuspicionJudgement = WorkspaceInsert<'suspicious_activity_logs'>;
type SuspicionJudgementReferences = Partial<
	Pick<SuspicionJudgement, 'job_assignment_id' | 'origin' | 'review_id' | 'evidence_id'>
>;
type OpenJudgementInput = Partial<
	Pick<SuspicionJudgement, 'reason' | 'origin' | 'basis' | 'evidence_id'>
>;

export function assertOpenJudgement(input: ResolutionTuple): void {
	if (input.resolution != null || input.resolved_at != null || input.resolved_by != null) {
		throw new Error('A new suspicion judgement must start unresolved.');
	}
}

export function normalizeOpenJudgement<T extends OpenJudgementInput>(
	input: T
): T & { readonly origin: 'automation' | 'human'; readonly basis: string } {
	if (input.reason == null || input.reason.trim() === '') {
		throw new Error('Suspicion judgement reason cannot be empty.');
	}
	if (input.origin != null && input.origin !== 'automation' && input.origin !== 'human') {
		throw new Error('Suspicion judgement origin must be automation or human.');
	}
	if (input.origin === 'automation' && (input.basis == null || input.basis.trim() === '')) {
		throw new Error('An automated suspicion judgement must supply its reviewed evidence basis.');
	}
	return {
		...input,
		origin: input.origin ?? 'human',
		basis:
			input.basis == null || input.basis.trim() === ''
				? JSON.stringify({
						kind: 'human_judgement',
						reason: input.reason,
						evidence_id: input.evidence_id ?? null
					})
				: input.basis
	};
}

export function assertJudgementReferences(
	input: SuspicionJudgementReferences,
	prepared: SuspicionCreatePrepared
): void {
	const assignmentId = input.job_assignment_id;
	if (assignmentId == null || !prepared.assignmentIds.has(assignmentId)) {
		throw new Error('Suspicion judgement must reference an existing job assignment.');
	}
	if (input.origin === 'automation' && input.review_id == null) {
		throw new Error('An automated suspicion judgement must reference its inference review.');
	}
	if (input.origin === 'human' && input.review_id != null) {
		throw new Error('A human suspicion judgement cannot claim an automated inference review.');
	}
	if (
		input.review_id != null &&
		prepared.assignmentByReviewId.get(input.review_id) !== assignmentId
	) {
		throw new Error('Suspicion review belongs to another job assignment.');
	}
	if (
		input.evidence_id != null &&
		prepared.assignmentByEvidenceId.get(input.evidence_id) !== assignmentId
	) {
		throw new Error('Suspicion evidence belongs to another job assignment.');
	}
}

export function assertResolutionTransition(
	input: ResolutionTuple & Readonly<Record<string, unknown>>,
	existing: Required<ResolutionTuple> & Readonly<Record<string, unknown>>
): void {
	for (const field of immutableJudgementFields) {
		if (input[field] !== undefined && input[field] !== existing[field]) {
			throw new Error('A suspicion judgement and its evidence basis are immutable.');
		}
	}

	if (existing.resolved_at != null) {
		if (
			input.resolution !== undefined ||
			input.resolved_at !== undefined ||
			input.resolved_by !== undefined
		) {
			throw new Error('A resolved suspicion judgement cannot be reopened or rewritten.');
		}
		return;
	}

	const resolution = input.resolution;
	const resolvedAt = input.resolved_at;
	const resolvedBy = input.resolved_by;
	const touched = resolution !== undefined || resolvedAt !== undefined || resolvedBy !== undefined;
	if (!touched) return;
	if (
		resolution == null ||
		resolution.trim() === '' ||
		resolvedAt == null ||
		resolvedBy == null ||
		resolvedBy === ''
	) {
		throw new Error('Resolution, resolved_at, and resolved_by must be written together.');
	}
}

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const assignmentIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.job_assignment_id == null ? [] : [input.job_assignment_id]
						)
					)
				];
				const reviewIds = [
					...new Set(inputs.flatMap((input) => (input.review_id == null ? [] : [input.review_id])))
				];
				const evidenceIds = [
					...new Set(
						inputs.flatMap((input) => (input.evidence_id == null ? [] : [input.evidence_id]))
					)
				];
				const [assignments, reviews, evidence] = yield* Effect.all(
					[
						assignmentIds.length
							? api.db.query.job_assignments.findMany({
									where: { id: { in: assignmentIds } },
									columns: { id: true },
									limit: SUSPICION_BATCH_LIMIT
								})
							: Effect.succeed([]),
						reviewIds.length
							? api.db.query.suspicion_reviews.findMany({
									where: { id: { in: reviewIds } },
									columns: { id: true, job_assignment_id: true },
									limit: SUSPICION_BATCH_LIMIT
								})
							: Effect.succeed([]),
						evidenceIds.length
							? api.db.query.photo_evidence.findMany({
									where: { id: { in: evidenceIds } },
									columns: { id: true, job_assignment_id: true, variation_request_id: true },
									limit: SUSPICION_BATCH_LIMIT
								})
							: Effect.succeed([])
					],
					{ concurrency: 'unbounded' }
				);
				const variationIds = [
					...new Set(
						evidence.flatMap((photo) =>
							photo.job_assignment_id == null && photo.variation_request_id != null
								? [photo.variation_request_id]
								: []
						)
					)
				];
				const variations = variationIds.length
					? yield* api.db.query.variation_requests.findMany({
							where: { id: { in: variationIds } },
							columns: { id: true, job_assignment_id: true },
							limit: SUSPICION_BATCH_LIMIT
						})
					: [];
				const assignmentByVariationId = new Map(
					variations.map((variation) => [variation.id, variation.job_assignment_id])
				);
				return {
					assignmentIds: new Set(assignments.map((assignment) => assignment.id)),
					assignmentByReviewId: new Map(
						reviews.map((review) => [review.id, review.job_assignment_id])
					),
					assignmentByEvidenceId: new Map(
						evidence.map((photo) => [
							photo.id,
							photo.job_assignment_id ??
								(photo.variation_request_id == null
									? null
									: (assignmentByVariationId.get(photo.variation_request_id) ?? null))
						])
					)
				};
			}),
		perRecord: {
			before: {
				description:
					'Creates an open AI or authorized-human judgement with a stable source key and immutable evidence basis.',
				handler: ({ input, prepared }) => {
					const normalized = normalizeOpenJudgement(input);
					assertOpenJudgement(normalized);
					assertJudgementReferences(normalized, prepared);
					return normalized;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Keeps the judgement immutable and permits exactly one atomic open-to-resolved transition.',
				handler: ({ input, existing }) => {
					assertResolutionTransition(input, existing);
					return input;
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains suspicion judgements and their resolutions as an audit trail.',
				handler: () => Effect.fail(new Error('Suspicion judgements cannot be deleted.'))
			}
		}
	}
} satisfies Hooks<SuspicionCreatePrepared>;
