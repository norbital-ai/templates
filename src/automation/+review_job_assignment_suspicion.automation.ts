import { automation } from '@norbital-ai/bolt';
import {
	AwaitingInspection,
	backfillScenes,
	inspectPendingPhotos,
	messageOf,
	nextQuarterHour,
	reviewAssignment,
	uncheckedAssignments
} from '../lib/suspicion-review.js';

/** Reviews in flight at once: bounded by the provider's rate, not by the run. */
const REVIEWS_AT_ONCE = 6;

const review = automation({
	description:
		"When an assignment is filed or changes: inspects photos awaiting facts (fills each one's sha256, perceptual embedding and integrity flags), then reviews every unchecked assignment with AI and creates an idempotent suspicion log only when the model judges the combined evidence suspicious. A review that fails stamps nothing and is retried at the next quarter hour.",
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
	concurrency: { max: 1 }
});
export default review;

review.run(async (input, ctx) => {
	await ctx.progress({ ratio: 0.02, text: 'Inspecting filed photos' });
	const inspection = await inspectPendingPhotos(ctx);
	const unreadable = new Set(inspection.failures.map((failure) => failure.photo_id));
	await ctx.progress({ ratio: 0.03, text: 'Placing photos without a scene' });
	await backfillScenes(ctx);
	await ctx.progress({ ratio: 0.05, text: 'Loading unchecked assignments' });
	const only = input.assignment_id != null ? [input.assignment_id] : (input.ids ?? undefined);
	const assignments = await uncheckedAssignments(ctx, only);
	const counts: Record<string, number> = {
		checked: 0,
		inspected_photos: inspection.inspected,
		inspection_failed: inspection.failures.length
	};
	const failures: string[] = [];
	let inferences = 0;
	// each review is one model call on its own evidence: REVIEWS_AT_ONCE run side by side, not one after another
	let done = 0;
	const reviewOne = async (assignment: (typeof assignments)[number]) => {
		try {
			const status = await reviewAssignment(ctx, assignment);
			inferences += 1;
			counts.checked! += 1;
			counts[status] = (counts[status] ?? 0) + 1;
		} catch (error) {
			const waiting = error instanceof AwaitingInspection;
			if (waiting && !unreadable.has(error.photoId))
				counts.awaiting_inspection = (counts.awaiting_inspection ?? 0) + 1;
			else failures.push(`${assignment.id}: ${messageOf(error)}`);
			if (!waiting) inferences += 1;
		}
		done += 1;
		await ctx.progress({
			ratio: 0.05 + (done / assignments.length) * 0.9,
			text: `Reviewed assignment ${done} of ${assignments.length}`
		});
	};
	const queue = [...assignments];
	await Promise.all(
		Array.from({ length: Math.min(REVIEWS_AT_ONCE, queue.length) }, async () => {
			for (let next = queue.shift(); next !== undefined; next = queue.shift())
				await reviewOne(next);
		})
	);
	// anything left unread (a failed turn, a photo still queued) is retried at the next quarter hour, once; a photo the
	// host could not read is durably marked, so it is not re-inspected and schedules no retry of its own
	if (failures.length > 0 || (counts.awaiting_inspection ?? 0) > 0)
		await ctx.schedule(
			'review_job_assignment_suspicion',
			{},
			{ at: nextQuarterHour(String(ctx.now)) as never, key: 'suspicion_retry' }
		);
	if (failures.length > 0)
		throw new Error(
			`Suspicion review did not complete: ${failures.length} of ${assignments.length} assignments failed; first failure ${failures[0]}`
		);
	return {
		assignment_count: assignments.length,
		inference_count: inferences,
		failure_count: 0,
		counts
	};
});
