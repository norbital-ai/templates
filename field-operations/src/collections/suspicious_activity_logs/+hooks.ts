import {
	refuse,
	type MutateBeforeContext,
	type MutateEditContext
} from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { CollectionMutationValues } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
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

type SuspicionJudgement = CollectionMutationValues<WorkspaceSchema, 'suspicious_activity_logs'>;
type SuspicionJudgementReferences = Partial<
	Pick<SuspicionJudgement, 'job_assignment_id' | 'origin' | 'review_id' | 'evidence_id'>
>;
type OpenJudgementInput = Partial<
	Pick<SuspicionJudgement, 'reason' | 'origin' | 'basis' | 'evidence_id'>
>;

export function assertOpenJudgement(input: ResolutionTuple): void {
	if (input.resolution != null || input.resolved_at != null || input.resolved_by != null) {
		refuse('A new suspicion judgement must start unresolved.');
	}
}

export function normalizeOpenJudgement<T extends OpenJudgementInput>(
	input: T
): T & { readonly origin: 'automation' | 'human'; readonly basis: string } {
	if (input.reason == null || input.reason.trim() === '') {
		refuse('Suspicion judgement reason cannot be empty.');
	}
	if (input.origin != null && input.origin !== 'automation' && input.origin !== 'human') {
		refuse('Suspicion judgement origin must be automation or human.');
	}
	if (input.origin === 'automation' && (input.basis == null || input.basis.trim() === '')) {
		refuse('An automated suspicion judgement must supply its reviewed evidence basis.');
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
		refuse('Suspicion judgement must reference an existing job assignment.');
	}
	if (input.origin === 'automation' && input.review_id == null) {
		refuse('An automated suspicion judgement must reference its inference review.');
	}
	if (input.origin === 'human' && input.review_id != null) {
		refuse('A human suspicion judgement cannot claim an automated inference review.');
	}
	if (
		input.review_id != null &&
		prepared.assignmentByReviewId.get(input.review_id) !== assignmentId
	) {
		refuse('Suspicion review belongs to another job assignment.');
	}
	if (
		input.evidence_id != null &&
		prepared.assignmentByEvidenceId.get(input.evidence_id) !== assignmentId
	) {
		refuse('Suspicion evidence belongs to another job assignment.');
	}
}

export function assertResolutionTransition(
	input: ResolutionTuple & Readonly<Record<string, unknown>>,
	existing: Required<ResolutionTuple> & Readonly<Record<string, unknown>>
): void {
	for (const field of immutableJudgementFields) {
		if (input[field] !== undefined && input[field] !== existing[field]) {
			refuse('A suspicion judgement and its evidence basis are immutable.');
		}
	}

	if (existing.resolved_at != null) {
		if (
			input.resolution !== undefined ||
			input.resolved_at !== undefined ||
			input.resolved_by !== undefined
		) {
			refuse('A resolved suspicion judgement cannot be reopened or rewritten.');
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
		refuse('Resolution, resolved_at, and resolved_by must be written together.');
	}
}

/** The context a `mutate.before` handler receives, named so the two halves can be hoisted. */
type BeforeContext = MutateBeforeContext<Hooks<SuspicionCreatePrepared>>;

/** The same context on an edit, where `existing` is the stored row rather than undefined. */
type EditContext = MutateEditContext<Hooks<SuspicionCreatePrepared>>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, prepared }: BeforeContext) => {
	const normalized = normalizeOpenJudgement(input);
	assertOpenJudgement(normalized);
	assertJudgementReferences(normalized, prepared);
	return normalized;
};

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing }: EditContext) => {
	assertResolutionTransition(input, existing);
	return input;
};

export default {
	mutate: {
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
							? api.db.job_assignments.findMany({
									where: { id: { in: assignmentIds } },
									columns: { id: true },
									limit: SUSPICION_BATCH_LIMIT
								})
							: Effect.succeed([]),
						reviewIds.length
							? api.db.suspicion_reviews.findMany({
									where: { id: { in: reviewIds } },
									columns: { id: true, job_assignment_id: true },
									limit: SUSPICION_BATCH_LIMIT
								})
							: Effect.succeed([]),
						evidenceIds.length
							? api.db.photo_evidence.findMany({
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
					? yield* api.db.variation_requests.findMany({
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
					'Creates an open AI or authorized-human judgement with a stable source key and immutable evidence basis. Keeps the judgement immutable and permits exactly one atomic open-to-resolved transition.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains suspicion judgements and their resolutions as an audit trail.',
				handler: () => refuse('Suspicion judgements cannot be deleted.')
			}
		}
	}
} satisfies Hooks<SuspicionCreatePrepared>;
