import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Schema, Semaphore } from 'effect';
import { currentDate } from '../lib/clock.js';
import {
	clipText,
	embedFiledPhotos,
	AwaitingInspection,
	inspectFiledPhotos,
	loadUncheckedAssignments,
	reviewAssignmentSuspicion
} from './suspicion-review.js';

const InputSchema = Schema.Struct({
	/** Manual runs may target one unchecked assignment; scheduled runs omit it. */
	assignment_id: Schema.optionalKey(Schema.String.check(Schema.isUUID()))
});

const OutputSchema = Schema.Struct({
	reviewed_at: Schema.String,
	assignment_count: Schema.Number,
	inference_count: Schema.Number,
	failure_count: Schema.Number,
	failure_details: Schema.Array(
		Schema.Struct({ assignment_id: Schema.String, stage: Schema.String })
	),
	failure_details_truncated: Schema.Boolean,
	counts: Schema.Record(Schema.String, Schema.Number)
});

const MAX_FAILURE_DETAILS = 100;
const MAX_FAILURE_SUMMARY_CHARS = 500;
/** Bound provider concurrency while independent assignment reviews make progress. */
export const SUSPICION_REVIEW_CONCURRENCY = 4;

const failureSummary = (error: unknown): string =>
	clipText(
		(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
			.replace(/\s+/g, ' ')
			.trim(),
		MAX_FAILURE_SUMMARY_CHARS
	);

type SuspicionReviewAutomationResult = Schema.Schema.Type<typeof OutputSchema>;

/** Keeps the complete bounded audit summary on a failed run while making its task status truthful. */
export class SuspicionReviewIncompleteError extends Error {
	readonly outcome: SuspicionReviewAutomationResult;

	constructor(outcome: SuspicionReviewAutomationResult, firstFailureSummary?: string) {
		const first = outcome.failure_details[0];
		super(
			`Suspicion review did not complete: ${outcome.failure_count} of ${outcome.assignment_count} assignments failed${first === undefined ? '.' : `; first failure ${first.assignment_id} at ${first.stage}.`}${firstFailureSummary === undefined || firstFailureSummary === '' ? '' : ` Cause: ${firstFailureSummary}`}`
		);
		this.name = 'SuspicionReviewIncompleteError';
		this.outcome = outcome;
	}
}

export default defineAutomation(
	{ schedule: '*/15 * * * *' },
	{
		input: InputSchema,
		output: OutputSchema,
		policies: ['suspicion_review_automation'],
		description:
			'Every 15 minutes and on manual request, embeds newly filed photos, then reviews every unchecked assignment with AI and creates an idempotent suspicion log only when the model judges the combined evidence suspicious.',
		handler: (api, { args }) =>
			Effect.gen(function* () {
				yield* api.progress({ progress: 0.02, text: 'Embedding filed photos' });
				const embedding = yield* embedFiledPhotos(api).pipe(
					Effect.catch((error: unknown) =>
						Effect.succeed({ embedded: 0, failed: 1, issues: [failureSummary(error)] })
					)
				);
				if (embedding.failed > 0) {
					yield* Effect.logError(
						`[field-ops-suspicion-review] ${embedding.failed} photo embedding(s) failed`,
						embedding.issues.join('; ')
					);
				}
				yield* api.progress({ progress: 0.04, text: 'Inspecting filed photos' });
				const inspection = yield* inspectFiledPhotos(api);
				const failedInspections = new Set(inspection.failures.map(({ photo_id }) => photo_id));
				yield* api.progress({ progress: 0.05, text: 'Loading unchecked assignments' });
				const assignments = yield* loadUncheckedAssignments(api, args.assignment_id);
				const progressLock = yield* Semaphore.make(1);
				const counts: Record<string, number> = {
					checked: 0,
					failed: 0,
					embedded_photos: embedding.embedded,
					embedding_failed: embedding.failed,
					inspected_photos: inspection.inspected,
					inspection_failed: inspection.failures.length
				};
				let inferenceCount = 0;
				let failureCount = 0;
				let completedCount = 0;
				let firstFailureLogged = false;
				let firstFailureSummary: string | undefined;
				const failureDetails: Array<{ assignment_id: string; stage: string }> = [];
				const recordFailure = (assignmentId: string, stage: string, cause?: unknown) =>
					Effect.gen(function* () {
						// Another run can finish while inference is in flight. The policy then hides the
						// checked assignment and its evidence; do not turn that successful race into failure.
						if ((yield* loadUncheckedAssignments(api, assignmentId)).length === 0) {
							counts.skipped_no_longer_pending = (counts.skipped_no_longer_pending ?? 0) + 1;
							return;
						}
						failureCount += 1;
						counts.failed += 1;
						if (failureDetails.length < MAX_FAILURE_DETAILS)
							failureDetails.push({ assignment_id: assignmentId, stage });
						if (!firstFailureLogged && cause !== undefined) {
							firstFailureLogged = true;
							firstFailureSummary = failureSummary(cause);
							yield* Effect.logError(
								`[field-ops-suspicion-review] first assignment failure (${assignmentId})`,
								cause
							);
						}
					});
				const publishCompletion = () =>
					progressLock.withPermit(
						Effect.suspend(() => {
							completedCount += 1;
							return api.progress({
								progress:
									assignments.length === 0
										? 0.95
										: 0.05 + (completedCount / assignments.length) * 0.9,
								text: `Reviewed assignment ${completedCount} of ${assignments.length}`
							});
						})
					);
				yield* Effect.forEach(
					assignments,
					(assignment) =>
						Effect.gen(function* () {
							const review = yield* reviewAssignmentSuspicion(api, assignment).pipe(
								Effect.map((result) => ({ success: true as const, result })),
								Effect.catch((error) => Effect.succeed({ success: false as const, error }))
							);
							// Every outcome past fact loading asked the model, whether or not it answered.
							if (
								review.success
									? review.result.status !== 'skipped_checked'
									: review.error.stage !== 'fact_loading'
							)
								inferenceCount += 1;
							// Queued behind this run's single inspection: waiting, not failed.
							if (
								!review.success &&
								review.error.cause instanceof AwaitingInspection &&
								!failedInspections.has(review.error.cause.photoId)
							) {
								counts.awaiting_inspection = (counts.awaiting_inspection ?? 0) + 1;
								yield* publishCompletion();
								return;
							}
							if (!review.success) {
								yield* recordFailure(assignment.id, review.error.stage, review.error.cause);
								yield* publishCompletion();
								return;
							}
							const stamped = yield* currentDate.pipe(
								Effect.flatMap((checkedAt) =>
									api.collection.job_assignments.update(assignment.id, {
										suspicion_checked_at: checkedAt.toISOString()
									})
								),
								Effect.map(() => true as const),
								Effect.catch(() => Effect.succeed(false as const))
							);
							if (!stamped) {
								yield* recordFailure(assignment.id, 'check_stamp');
								yield* publishCompletion();
								return;
							}
							counts.checked += 1;
							counts[review.result.status] = (counts[review.result.status] ?? 0) + 1;
							yield* publishCompletion();
						}),
					{ concurrency: SUSPICION_REVIEW_CONCURRENCY, discard: true }
				);
				yield* api.progress({ progress: 1, text: 'Suspicion review complete' });
				const outcome = {
					reviewed_at: (yield* currentDate).toISOString(),
					assignment_count: assignments.length,
					inference_count: inferenceCount,
					failure_count: failureCount,
					failure_details: failureDetails,
					failure_details_truncated: failureCount > failureDetails.length,
					counts
				} satisfies SuspicionReviewAutomationResult;
				if (failureCount > 0)
					return yield* Effect.fail(
						new SuspicionReviewIncompleteError(outcome, firstFailureSummary)
					);
				return outcome;
			})
	}
);
