import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import model from './+model.js';

const VARIATION_BATCH_LIMIT = 5000;

/**
 * A variation is raised against one job assignment and, once filed, keeps the source message it
 * came from: `source_message_id` is accepted on create only.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				job_assignment_id: true,
				requested_at: true,
				title: true,
				description: true,
				amount: true,
				source_message_id: true
			}
		}
	},
	update: {
		input: {
			columns: {
				job_assignment_id: true,
				requested_at: true,
				title: true,
				description: true,
				amount: true
			}
		}
	},
	delete: {},
	/**
	 * Ties a scope change to an existing job assignment and rejects a second variation raised from
	 * the same source message. `source_message_id` carries a unique index, so a repeat is refused by
	 * the database anyway — the read is what turns that into a sentence a person can act on.
	 */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const assignmentIds = [
				...new Set(
					inputs.flatMap((input) => (input.job_assignment_id ? [input.job_assignment_id] : []))
				)
			];
			const sourceMessageIds = [
				...new Set(
					inputs.flatMap((input, index) =>
						existing[index] === undefined && 'source_message_id' in input && input.source_message_id
							? [input.source_message_id]
							: []
					)
				)
			];
			const [assignments, taken] = yield* Effect.all(
				[
					assignmentIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { id: { in: assignmentIds } },
								columns: { id: true },
								limit: VARIATION_BATCH_LIMIT
							}),
					sourceMessageIds.length === 0
						? Effect.succeed([])
						: db.variation_requests.findMany({
								where: { source_message_id: { in: sourceMessageIds } },
								columns: { source_message_id: true },
								limit: VARIATION_BATCH_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			const known = new Set(assignments.map((assignment) => assignment.id));
			const takenSourceMessageIds = new Set(taken.map((row) => row.source_message_id));
			return inputs.map((input, index) => {
				if (input.job_assignment_id !== undefined && !known.has(input.job_assignment_id)) {
					refuse('Referenced job assignment does not exist.');
				}
				if (existing[index] !== undefined) return input;
				if (
					'source_message_id' in input &&
					input.source_message_id &&
					takenSourceMessageIds.has(input.source_message_id)
				) {
					refuse('A variation request with this source_message_id already exists.');
				}
				return input;
			});
		})
});
