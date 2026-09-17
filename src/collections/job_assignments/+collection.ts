import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDate } from '../../lib/clock.js';
import model from './+model.js';
import type { CreateInput, UpdateInput } from './$types.js';

const ASSIGNMENT_BATCH_LIMIT = 5_000;

/** Which values a batch claims more than once — the one thing a stored-row read cannot see. */
function repeatedWithin(values: ReadonlyArray<string>): ReadonlySet<string> {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return repeated;
}

/**
 * A dispatch names its job and its person and may carry the dispatch time, the initial stage and
 * the channel message it came from. `search_text` is derived from the job and `suspicion_checked_at`
 * is stamped by the review automation, so neither is a create input; once dispatched, an assignment
 * stays on its job, its assignee and its source message — the update selection carries only
 * progress.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				job_id: true,
				assignee_user_id: true,
				dispatched_at: true,
				status: true,
				completed_at: true,
				amount_charged: true,
				location: true,
				summary: true,
				source_message_id: true
			}
		}
	},
	update: {
		input: {
			columns: {
				dispatched_at: true,
				status: true,
				completed_at: true,
				amount_charged: true,
				location: true,
				summary: true,
				suspicion_checked_at: true
			}
		}
	},
	delete: {},
	/**
	 * Dispatches a person to a job nobody holds, stamps the dispatch time and copies the job title
	 * onto the board's search label; thereafter stamps completion when the work is moved to
	 * `completed`. The world one dispatch asks about — does the job exist, is it taken, is the
	 * source message used — is read once for the whole batch. Assignee existence is the database
	 * foreign key's to check: authored code holds no query over the private user table.
	 */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const creates = inputs.flatMap((input, index) =>
				existing[index] === undefined && 'job_id' in input ? [input] : []
			);
			const jobIds = [...new Set(creates.map((input) => input.job_id))];
			const claimedSources = creates.flatMap((input) =>
				input.source_message_id ? [input.source_message_id] : []
			);
			const sourceMessageIds = [...new Set(claimedSources)];
			const [jobs, occupied, sources] = yield* Effect.all(
				[
					jobIds.length === 0
						? Effect.succeed([])
						: db.jobs.findMany({
								where: { id: { in: jobIds } },
								columns: { id: true, title: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							}),
					jobIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { job_id: { in: jobIds } },
								columns: { job_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							}),
					sourceMessageIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { source_message_id: { in: sourceMessageIds } },
								columns: { source_message_id: true },
								limit: ASSIGNMENT_BATCH_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			const titleByJobId = new Map(jobs.map((job) => [job.id, job.title]));
			const occupiedJobIds = new Set([
				...occupied.map((assignment) => assignment.job_id),
				...repeatedWithin(creates.map((input) => input.job_id))
			]);
			const takenSourceMessageIds = new Set([
				...sources.flatMap((row) => (row.source_message_id ? [row.source_message_id] : [])),
				...repeatedWithin(claimedSources)
			]);
			const now = (yield* currentDate).toISOString();
			return inputs.map((input, index) => {
				const stored = existing[index];
				if (stored === undefined) {
					if (!('job_id' in input)) refuse('Job assignment must reference a job.');
					const title = titleByJobId.get(input.job_id);
					if (title === undefined) refuse('Referenced job does not exist.');
					if (occupiedJobIds.has(input.job_id)) refuse('This job already has an assignment.');
					if (input.source_message_id && takenSourceMessageIds.has(input.source_message_id)) {
						refuse('A job assignment with this source_message_id already exists.');
					}
					return {
						...input,
						dispatched_at: input.dispatched_at ?? now,
						status: input.status ?? 'assigned',
						// Derived last so a caller cannot forge or stale the board's search label.
						search_text: title
					};
				}
				const progress = input as UpdateInput;
				return progress.status === 'completed' &&
					(progress.completed_at ?? stored.completed_at) == null
					? { ...progress, completed_at: now }
					: progress;
			});
		})
});
