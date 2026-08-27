import { Effect } from 'effect';
import { currentDeskDate } from '../../lib/clock.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Stamps a task activity with the current desk date as its due date when none was entered.',
				handler: ({ input }) =>
					input.type === 'task' && input.due_date == null
						? Effect.map(currentDeskDate, (due_date) => ({ ...input, due_date }))
						: Effect.succeed(input)
			}
		}
	}
} satisfies Hooks;
