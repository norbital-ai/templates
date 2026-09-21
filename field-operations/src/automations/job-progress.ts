import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';

export const JobProgressOutputSchema = Schema.Struct({
	job_id: Schema.String,
	status: Schema.Literals(['assigned', 'completed']),
	written: Schema.Boolean
});

/**
 * A job's state, from the state of the assignment on it.
 *
 * A job still distinguishes `in_progress`, and an assignment no longer does — so nothing maps onto
 * it any more. `in_progress` on a job is a claim about work happening right now, and nothing in
 * this workspace ever observed that. Idempotent: the job is read first and left alone when it
 * already says what the assignment says.
 */
export const carryAssignmentProgressToJob = (
	api: Api,
	assignment: Readonly<{ readonly job_id: string; readonly status: string | null }>
) =>
	Effect.gen(function* () {
		const status =
			assignment.status === 'completed' ? ('completed' as const) : ('assigned' as const);
		const job = yield* api.db.jobs.findFirst({
			where: { id: { eq: assignment.job_id } },
			columns: { id: true, status: true }
		});
		if (job === undefined || job.status === status) {
			return { job_id: assignment.job_id, status, written: false };
		}
		yield* api.collection.jobs.update(job.id, { status });
		return { job_id: assignment.job_id, status, written: true };
	});
