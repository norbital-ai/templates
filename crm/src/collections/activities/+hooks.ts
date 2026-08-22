import { Clock, Effect } from 'effect';
import { deskToday } from '../../lib/desk-date.js';
import type { Hooks } from './$types.js';

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Stamps a task activity with the current desk date as its due date when none was entered.',
				handler: ({ input }) =>
					Effect.gen(function* () {
						if (input.type === 'task' && input.due_date == null) {
							const now = new Date(yield* Clock.currentTimeMillis);
							return { ...input, due_date: deskToday(now) };
						}
						return input;
					})
			}
		}
	}
} satisfies Hooks;
