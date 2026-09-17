import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import model from './+model.js';

const SUSPICION_BATCH_LIMIT = 5_000;

type JudgementReferences = {
	readonly assignmentIds: ReadonlySet<string>;
	readonly assignmentByReviewId: ReadonlyMap<string, string>;
	readonly assignmentByEvidenceId: ReadonlyMap<string, string | null>;
};

type OpenJudgement = {
	readonly job_assignment_id: string;
	readonly origin?: string | undefined;
	readonly basis?: string | null | undefined;
	readonly review_id?: string | null | undefined;
	readonly evidence_id?: string | null | undefined;
	readonly reason: string;
};

type Resolution = {
	readonly resolution?: string | null | undefined;
	readonly resolved_at?: string | null | undefined;
	readonly resolved_by?: string | null | undefined;
};

/**
 * A new judgement: a non-empty reason, a known origin, and a basis an automation must supply and a
 * person may leave to be composed from the reason.
 */
function openJudgement<T extends OpenJudgement>(
	input: T
): T & { readonly origin: 'automation' | 'human'; readonly basis: string } {
	if (input.reason.trim() === '') refuse('Suspicion judgement reason cannot be empty.');
	const origin = input.origin ?? 'human';
	if (origin !== 'automation' && origin !== 'human') {
		refuse('Suspicion judgement origin must be automation or human.');
	}
	if (origin === 'automation' && (input.basis == null || input.basis.trim() === '')) {
		refuse('An automated suspicion judgement must supply its reviewed evidence basis.');
	}
	return {
		...input,
		origin,
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

function assertJudgementReferences(
	input: OpenJudgement & { readonly origin: 'automation' | 'human' },
	references: JudgementReferences
): void {
	const assignmentId = input.job_assignment_id;
	if (!references.assignmentIds.has(assignmentId)) {
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
		references.assignmentByReviewId.get(input.review_id) !== assignmentId
	) {
		refuse('Suspicion review belongs to another job assignment.');
	}
	if (
		input.evidence_id != null &&
		references.assignmentByEvidenceId.get(input.evidence_id) !== assignmentId
	) {
		refuse('Suspicion evidence belongs to another job assignment.');
	}
}

/**
 * The one lifecycle transition a log has: open to resolved, once, with all three resolution
 * columns written together. The judgement itself is outside the update selection, so it cannot
 * be rewritten by construction.
 */
function assertResolutionTransition(input: Resolution, existing: Resolution): void {
	if (existing.resolved_at != null) {
		refuse('A resolved suspicion judgement cannot be reopened or rewritten.');
	}
	if (
		input.resolution == null ||
		input.resolution.trim() === '' ||
		input.resolved_at == null ||
		input.resolved_by == null ||
		input.resolved_by === ''
	) {
		refuse('Resolution, resolved_at, and resolved_by must be written together.');
	}
}

export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				job_assignment_id: true,
				origin: true,
				basis: true,
				review_id: true,
				evidence_id: true,
				reason: true
			}
		}
	},
	update: { input: { columns: { resolution: true, resolved_at: true, resolved_by: true } } },
	/**
	 * Creates an open AI or authorized-human judgement with an immutable evidence basis, and permits
	 * exactly one atomic open-to-resolved transition. The references a batch names are read in two
	 * waves: assignments, reviews and evidence first; the variations that evidence hangs off second.
	 */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const creates = inputs.flatMap((input, index) =>
				existing[index] === undefined && 'reason' in input ? [input] : []
			);
			const assignmentIds = [...new Set(creates.map((input) => input.job_assignment_id))];
			const reviewIds = [
				...new Set(creates.flatMap((input) => (input.review_id == null ? [] : [input.review_id])))
			];
			const evidenceIds = [
				...new Set(
					creates.flatMap((input) => (input.evidence_id == null ? [] : [input.evidence_id]))
				)
			];
			const [assignments, reviews, evidence] = yield* Effect.all(
				[
					assignmentIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { id: { in: assignmentIds } },
								columns: { id: true },
								limit: SUSPICION_BATCH_LIMIT
							}),
					reviewIds.length === 0
						? Effect.succeed([])
						: db.suspicion_reviews.findMany({
								where: { id: { in: reviewIds } },
								columns: { id: true, job_assignment_id: true },
								limit: SUSPICION_BATCH_LIMIT
							}),
					evidenceIds.length === 0
						? Effect.succeed([])
						: db.photo_evidence.findMany({
								where: { id: { in: evidenceIds } },
								columns: { id: true, job_assignment_id: true, variation_request_id: true },
								limit: SUSPICION_BATCH_LIMIT
							})
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
			const variations =
				variationIds.length === 0
					? []
					: yield* db.variation_requests.findMany({
							where: { id: { in: variationIds } },
							columns: { id: true, job_assignment_id: true },
							limit: SUSPICION_BATCH_LIMIT
						});
			const assignmentByVariationId = new Map(
				variations.map((variation) => [variation.id, variation.job_assignment_id])
			);
			const references: JudgementReferences = {
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
			return inputs.map((input, index) => {
				const stored = existing[index];
				if (stored !== undefined) {
					if ('reason' in input) {
						refuse('A suspicion judgement and its evidence basis are immutable.');
					}
					assertResolutionTransition(input, stored);
					return input;
				}
				if (!('reason' in input)) refuse('A new suspicion judgement needs a reason.');
				const judgement = openJudgement(input);
				assertJudgementReferences(judgement, references);
				return judgement;
			});
		})
});
