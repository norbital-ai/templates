import type { MutateBeforeContext, MutateEditContext } from '@norbital-ai/bolt/authoring';
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

/** The context a `mutate.before` handler receives, named so the two halves can be hoisted. */
type BeforeContext = MutateBeforeContext<Hooks<ReadonlySet<string>>>;

/** The same context on an edit, where `existing` is the stored row rather than undefined. */
type EditContext = MutateEditContext<Hooks<ReadonlySet<string>>>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, prepared }: BeforeContext) => {
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
};

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing }: EditContext) => {
	assertCommunicationUnchanged(input, existing);
	return input;
};

export default {
	mutate: {
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
					'Requires a non-empty provider message and stable source id; the assignment foreign key establishes its scope. Preserves an inbound field communication exactly as it was received.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
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
