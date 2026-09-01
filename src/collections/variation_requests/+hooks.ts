import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDate } from '../../lib/clock.js';
import type { Hooks } from './$types.js';

const VARIATION_BATCH_LIMIT = 5000;

/**
 * The job assignments this batch names, and which of its source messages are already spoken for.
 *
 * Two point queries per variation became two for the batch. The second one is why the read is worth
 * hoisting at all: `source_message_id` is a unique index, so a repeat inside the same call is
 * refused by the database anyway — this read is what turns that into a sentence a person can read
 * instead of a constraint violation.
 */
interface VariationRequestBatch {
	readonly assignmentIds: ReadonlySet<string>;
	readonly takenSourceMessageIds: ReadonlySet<string>;
}

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const assignmentIds = [
					...new Set(
						inputs.flatMap((input) => (input.job_assignment_id ? [input.job_assignment_id] : []))
					)
				];
				const sourceMessageIds = [
					...new Set(
						inputs.flatMap((input) => (input.source_message_id ? [input.source_message_id] : []))
					)
				];
				const assignments = assignmentIds.length
					? yield* api.db.job_assignments.findMany({
							where: { id: { in: assignmentIds } },
							columns: { id: true },
							limit: VARIATION_BATCH_LIMIT
						})
					: [];
				const taken = sourceMessageIds.length
					? yield* api.db.variation_requests.findMany({
							where: { source_message_id: { in: sourceMessageIds } },
							columns: { source_message_id: true },
							limit: VARIATION_BATCH_LIMIT
						})
					: [];
				return {
					assignmentIds: new Set(assignments.map((assignment) => assignment.id)),
					takenSourceMessageIds: new Set(
						taken.flatMap((row) => (row.source_message_id ? [row.source_message_id] : []))
					)
				};
			}),
		perRecord: {
			before: {
				description:
					'Ties a scope change to an existing job assignment, rejects a second variation raised from the same source message, and stamps when it was requested.',
				handler: ({ input, prepared }) => {
					if (input.job_assignment_id == null || input.job_assignment_id === '') {
						refuse('Variation request must reference a job assignment.');
					}
					if (!prepared.assignmentIds.has(input.job_assignment_id)) {
						refuse('Referenced job assignment does not exist.');
					}

					if (
						input.source_message_id != null &&
						input.source_message_id !== '' &&
						prepared.takenSourceMessageIds.has(input.source_message_id)
					) {
						refuse('A variation request with this source_message_id already exists.');
					}

					return input.requested_at == null
						? Effect.map(currentDate, (now) => ({ ...input, requested_at: now.toISOString() }))
						: Effect.succeed({ ...input, requested_at: input.requested_at });
				}
			}
		}
	}
} satisfies Hooks<VariationRequestBatch>;
