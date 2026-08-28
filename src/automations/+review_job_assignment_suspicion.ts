import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { currentDate } from '../lib/clock.js';
import { loadUncheckedAssignments, reviewAssignmentSuspicion } from './suspicion-review.js';

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

export type SuspicionReviewAutomationResult = Readonly<{
	reviewed_at: string;
	assignment_count: number;
	inference_count: number;
	failure_count: number;
	failure_details: ReadonlyArray<Readonly<{ assignment_id: string; stage: string }>>;
	failure_details_truncated: boolean;
	counts: Readonly<Record<string, number>>;
}>;

/** Keeps the complete bounded audit summary on a failed run while making its task status truthful. */
export class SuspicionReviewIncompleteError extends Error {
	readonly outcome: SuspicionReviewAutomationResult;

	constructor(outcome: SuspicionReviewAutomationResult) {
		const first = outcome.failure_details[0];
		super(
			`Suspicion review did not complete: ${outcome.failure_count} of ${outcome.assignment_count} assignments failed${first === undefined ? '.' : `; first failure ${first.assignment_id} at ${first.stage}.`}`
		);
		this.name = 'SuspicionReviewIncompleteError';
		this.outcome = outcome;
	}
}

export default defineAutomation(
	{ schedule: '0 * * * *' },
	{
		input: InputSchema,
		output: OutputSchema,
		policies: ['suspicion_review_automation'],
		description:
			'Hourly and on manual request, reviews every unchecked assignment with AI and creates an idempotent suspicion log only when the model judges the combined evidence suspicious.',
		handler: (api, { args }) =>
			Effect.gen(function* () {
				yield* api.progress({ progress: 0.02, text: 'Loading unchecked assignments' });
				const assignments = yield* loadUncheckedAssignments(api, args.assignment_id);
				const counts: Record<string, number> = { checked: 0, failed: 0 };
				let inferenceCount = 0;
				let failureCount = 0;
				let firstFailureLogged = false;
				const failureDetails: Array<{ assignment_id: string; stage: string }> = [];
				const recordFailure = (assignmentId: string, stage: string) => {
					failureCount += 1;
					if (failureDetails.length < MAX_FAILURE_DETAILS) {
						failureDetails.push({ assignment_id: assignmentId, stage });
					}
				};
				for (const [index, assignment] of assignments.entries()) {
					yield* api.progress({
						progress: assignments.length === 0 ? 0.9 : 0.05 + (index / assignments.length) * 0.9,
						text: `Reviewing assignment ${index + 1} of ${assignments.length}`
					});
					let inferenceStarted = false;
					let inferenceSucceeded = false;
					let reviewPersisted = false;
					const review = yield* reviewAssignmentSuspicion(api, assignment, {
						inferenceStarted: () => {
							inferenceStarted = true;
							inferenceCount += 1;
						},
						inferenceSucceeded: () => {
							inferenceSucceeded = true;
						},
						reviewPersisted: () => {
							reviewPersisted = true;
						}
					}).pipe(
						Effect.map((result) => ({ success: true as const, result })),
						Effect.catch((error: unknown) => {
							if (firstFailureLogged) return Effect.succeed({ success: false as const });
							firstFailureLogged = true;
							return Effect.logError(
								`[field-ops-suspicion-review] first assignment failure (${assignment.id})`,
								error
							).pipe(Effect.as({ success: false as const }));
						})
					);
					if (!review.success) {
						counts.failed += 1;
						recordFailure(
							assignment.id,
							!inferenceStarted
								? 'fact_loading'
								: !inferenceSucceeded
									? 'inference'
									: !reviewPersisted
										? 'review_persistence'
										: 'suspicion_log_persistence'
						);
						continue;
					}
					const stamped = yield* currentDate.pipe(
						Effect.flatMap((checkedAt) =>
							api.db.job_assignments.mutate({
								id: assignment.id,
								suspicion_checked_at: checkedAt.toISOString()
							})
						),
						Effect.map(() => true as const),
						Effect.catch(() => Effect.succeed(false as const))
					);
					if (!stamped) {
						counts.failed += 1;
						recordFailure(assignment.id, 'check_stamp');
						continue;
					}
					counts.checked += 1;
					counts[review.result.status] = (counts[review.result.status] ?? 0) + 1;
				}
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
					return yield* Effect.fail(new SuspicionReviewIncompleteError(outcome));
				return outcome;
			})
	}
);
