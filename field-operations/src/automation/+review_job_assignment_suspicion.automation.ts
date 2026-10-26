import { automation } from '@norbital-ai/bolt';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import {
	backfillScenes,
	inspectPendingPhotos,
	messageOf,
	nextRetrySlot,
	reviewAssignment,
	uncheckedAssignments
} from '../lib/suspicion-review.js';
/** Reviews in flight at once: bounded by the provider's rate, not by the run. */
const REVIEWS_AT_ONCE = 6;
export default automation('review_job_assignment_suspicion', {
	description:
		"When an assignment is filed or changes: inspects photos awaiting facts (fills each one's sha256, perceptual embedding and integrity flags), then reviews every unchecked assignment with AI and creates an idempotent suspicion log only when the model judges the combined evidence suspicious. A review that fails stamps nothing and is retried at the next two-hour slot.",
	on: [
		{ created: 'job_assignments' },
		{
			updated: 'job_assignments',
			fields: ['suspicion_checked_at'],
			where: { suspicion_checked_at: { isNull: true } }
		}
	],
	input: {
		/** Event runs: the assignments that fired. */
		ids: { kind: 'list', of: { kind: 'id', of: 'job_assignments' }, optional: true },
		/** Manual runs may target one unchecked assignment. */
		assignment_id: { kind: 'id', of: 'job_assignments', optional: true }
	},
	output: {
		kind: 'object',
		fields: {
			assignment_count: { kind: 'int' },
			inference_count: { kind: 'int' },
			failure_count: { kind: 'int' },
			counts: { kind: 'record', of: { kind: 'int' } }
		}
	},
	runAs: ['suspicion_review_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		yield* ctx.progress({ ratio: 0.02, text: 'Inspecting filed photos' });
		const inspection = yield* inspectPendingPhotos(ctx);
		const unreadable = new Set<string>(inspection.failures.map((failure) => failure.photo_id));
		yield* ctx.progress({ ratio: 0.03, text: 'Placing photos without a scene' });
		yield* backfillScenes(ctx);
		yield* ctx.progress({ ratio: 0.05, text: 'Loading unchecked assignments' });
		const only = input.assignment_id != null ? [input.assignment_id] : (input.ids ?? undefined);
		// an assignment with a photo another run is inspecting is reviewed by the run that run starts once it is settled
		const held = new Set<string>(inspection.held);
		const unchecked = yield* uncheckedAssignments(ctx, only);
		const assignments = unchecked.filter((assignment) => !held.has(assignment.id));
		const counts: Record<string, number> = {
			checked: 0,
			inspected_photos: inspection.inspected,
			inspection_failed: inspection.failures.length
		};
		if (assignments.length < unchecked.length)
			counts.awaiting_inspection = unchecked.length - assignments.length;
		const failures: string[] = [];
		let inferences = 0;
		// each review is one model call on its own evidence: REVIEWS_AT_ONCE run side by side, not one after another
		let done = 0;
		const reviewOne = (assignment: (typeof assignments)[number]) =>
			Effect.flatMap(Effect.exit(reviewAssignment(ctx, assignment)), (exit) => {
				Exit.match(exit, {
					onSuccess: (status) => {
						inferences += 1;
						counts.checked = (counts.checked ?? 0) + 1;
						counts[status] = (counts[status] ?? 0) + 1;
					},
					// any other failure, a defect included, is this assignment's: the run goes on and fails naming it
					onFailure: (cause) => {
						const error = Cause.squash(cause);
						const failure = Cause.findErrorOption(cause);
						const waiting =
							Option.isSome(failure) &&
							failure.value._tag === 'AwaitingInspection' &&
							error === failure.value
								? failure.value
								: undefined;
						if (waiting !== undefined && !unreadable.has(waiting.photoId))
							counts.awaiting_inspection = (counts.awaiting_inspection ?? 0) + 1;
						else failures.push(`${assignment.id}: ${messageOf(error)}`);
						if (waiting === undefined) inferences += 1;
					}
				});
				done += 1;
				return ctx.progress({
					ratio: 0.05 + (done / assignments.length) * 0.9,
					text: `Reviewed assignment ${done} of ${assignments.length}`
				});
			});
		// Native reviews must finish before a progress failure releases the guest crossing.
		yield* Effect.forEach(
			assignments,
			(assignment) => reviewOne(assignment).pipe(Effect.uninterruptible),
			{ concurrency: REVIEWS_AT_ONCE, discard: true }
		);
		// anything left unread (a failed turn, a photo still queued) is retried at the next two-hour slot, once; a photo the
		// host could not read is durably marked, so it is not re-inspected and schedules no retry of its own
		if (failures.length > 0 || (counts.awaiting_inspection ?? 0) > 0)
			yield* ctx.schedule(
				'review_job_assignment_suspicion',
				{},
				{ at: nextRetrySlot(ctx.now), key: 'suspicion_retry' }
			);
		if (failures.length > 0) {
			const { ReviewIncomplete } = yield* Effect.promise(
				() => import('../lib/suspicion-review-failures.js')
			);
			return yield* new ReviewIncomplete({
				message: `Suspicion review did not complete: ${failures.length} of ${assignments.length} assignments failed; first failure ${failures[0]}`
			});
		}
		return {
			assignment_count: assignments.length,
			inference_count: inferences,
			failure_count: 0,
			counts
		};
	}
});
