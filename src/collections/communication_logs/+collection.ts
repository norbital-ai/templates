import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import model from './+model.js';

const COMMUNICATION_BATCH_LIMIT = 5_000;

/**
 * An inbound field communication is retained exactly as received: the declaration exposes no
 * `update` and no `delete`, so immutability is structural rather than a rule.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				job_assignment_id: true,
				message: true,
				sent_at: true,
				sender: true,
				source_message_id: true
			}
		}
	},
	transform: (inputs, { db }) =>
		Effect.gen(function* () {
			const assignmentIds = [...new Set(inputs.map((input) => input.job_assignment_id))];
			const assignments = yield* db.job_assignments.findMany({
				where: { id: { in: assignmentIds } },
				columns: { id: true },
				limit: COMMUNICATION_BATCH_LIMIT
			});
			const known = new Set(assignments.map((assignment) => assignment.id));
			return inputs.map((input) => {
				if (!known.has(input.job_assignment_id)) {
					refuse('Communication log must reference an existing job assignment.');
				}
				if (input.message.trim() === '') refuse('Communication log message cannot be empty.');
				if (input.sender.trim() === '') refuse('Communication log sender cannot be empty.');
				if (input.source_message_id.trim() === '') {
					refuse('Communication log source_message_id cannot be empty.');
				}
				return input;
			});
		})
});
