import { defineCollection } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDeskDate } from '../../lib/clock.js';
import model from './+model.js';

const columns = {
	regarding_type: true,
	regarding_id: true,
	type: true,
	subject: true,
	description: true,
	due_date: true,
	completed_at: true,
	owner_id: true
} as const;

const create = { input: { columns } } as const;
const update = create;

export default defineCollection({
	model,
	create,
	update,
	/** Stamps a task with the current desk date as its due date when none was entered. */
	transform: (inputs, { existing }) =>
		Effect.map(currentDeskDate, (today) =>
			inputs.map((input, i) =>
				existing[i] === undefined && input.type === 'task' && input.due_date == null
					? { ...input, due_date: today }
					: input
			)
		)
});
