import { Effect } from 'effect';
import type { Hooks } from './$types.js';

const COMMUNICATION_BATCH_LIMIT = 5_000;

const immutableCommunicationFields = [
	'job_assignment_id',
	'message',
	'sent_at',
	'sender',
	'source_message_id'
] as const;

export function assertCommunicationUnchanged(
	input: Readonly<Record<string, unknown>>,
	existing: Readonly<Record<string, unknown>>
): void {
	for (const field of immutableCommunicationFields) {
		if (input[field] !== undefined && input[field] !== existing[field]) {
			throw new Error('Field communication logs are immutable after receipt.');
		}
	}
}

export default {
	create: {
		prepare: ({ inputs, api }) => {
			const assignmentIds = [
				...new Set(
					inputs.flatMap((input) =>
						input.job_assignment_id == null ? [] : [input.job_assignment_id]
					)
				)
			];
			if (assignmentIds.length === 0) return Effect.succeed(new Set<string>());
			return Effect.map(
				api.db.job_assignments.findMany({
					where: { id: { in: assignmentIds } },
					columns: { id: true },
					limit: COMMUNICATION_BATCH_LIMIT
				}),
				(assignments) => new Set(assignments.map((assignment) => assignment.id))
			);
		},
		perRecord: {
			before: {
				description:
					'Requires a non-empty provider message and stable source id; the assignment foreign key establishes its scope.',
				handler: ({ input, prepared }) => {
					if (input.job_assignment_id == null || !prepared.has(input.job_assignment_id)) {
						throw new Error('Communication log must reference an existing job assignment.');
					}
					if (input.message == null || input.message.trim() === '') {
						throw new Error('Communication log message cannot be empty.');
					}
					if (input.sender == null || input.sender.trim() === '') {
						throw new Error('Communication log sender cannot be empty.');
					}
					if (input.source_message_id == null || input.source_message_id.trim() === '') {
						throw new Error('Communication log source_message_id cannot be empty.');
					}
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description: 'Preserves an inbound field communication exactly as it was received.',
				handler: ({ input, existing }) => {
					assertCommunicationUnchanged(input, existing);
					return input;
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains field communications as an immutable operational record.',
				handler: () => Effect.fail(new Error('Field communication logs cannot be deleted.'))
			}
		}
	}
} satisfies Hooks<ReadonlySet<string>>;
