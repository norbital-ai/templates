import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const columns = { employment_id: true, period: true } as const;

/**
 * A roster of record is one employment over one calendar month. Its existence is the whole fact:
 * while it stands, the month's work days are the schedule and outrank the pattern, and a run
 * refuses a cycle with a rostered day that names no shift. The month's dates follow from the
 * period, so nothing else is stored.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing }) =>
		Effect.sync(() =>
			inputs.map((input, index) => {
				const stored = existing[index];
				if (stored !== undefined) {
					for (const column of ['employment_id', 'period'] as const)
						if (column in input && input[column] !== stored[column])
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
		)
});
