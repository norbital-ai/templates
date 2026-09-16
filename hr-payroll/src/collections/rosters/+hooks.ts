import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A roster of record is one employment over one calendar month. Its existence is the whole fact:
 * while it stands, the month's work days are the schedule and outrank the pattern, and a run
 * refuses a cycle with a rostered day that names no shift. The month's dates follow from the
 * period, so nothing else is stored.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Requires the period as a calendar month (YYYY-MM) and keeps a roster on the employment and month it was created for.',
				handler: ({ input, existing }) =>
					Effect.sync(() => {
						if (existing !== undefined) {
							for (const column of ['employment_id', 'period'] as const)
								if (column in input && input[column] !== existing[column])
									refuse(
										`A roster’s ${column} is what it is the roster of; make a new roster for another month or person.`
									);
							return input;
						}
						if (input.employment_id == null || input.period == null)
							refuse('A roster names an employment and the calendar month it covers.');
						if (!PERIOD.test(input.period))
							refuse(`A roster period is a calendar month as YYYY-MM, not "${input.period}".`);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
