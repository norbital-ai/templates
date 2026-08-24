import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { readRange } from '../payroll_runs/lib/effective.js';

/**
 * One employment has at most one standing with one statutory scheme at any instant.
 *
 * The database is the guarantee — `employment_statutory_facts_no_overlap` in +model.ts rejects an
 * overlap with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another
 * row in the same createMany statement. Bolt translates that constraint into a caller-facing
 * overlap refusal. A SELECT precheck would be weaker and add one database round trip per bulk row.
 */
function requireId(value: string | null | undefined, what: string): string {
	if (value == null || value === '') {
		return refuse(`A statutory fact must reference ${what}.`);
	}
	return value;
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Requires both references and, for a system successor, validates and stages the predecessor close into the same approval graph.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						requireId(input.employment_id, 'an employment');
						requireId(input.statutory_contribution_id, 'a statutory contribution');
						if (input.supersedes_fact_id == null) return input;

						const predecessor = yield* api.db.query.employment_statutory_facts.findFirst({
							where: { id: { eq: input.supersedes_fact_id } }
						});
						if (predecessor == null) {
							refuse('The statutory fact this successor is meant to replace no longer exists.');
						}
						if (predecessor.employment_id !== input.employment_id) {
							refuse(
								'A statutory successor must belong to the same employment as its predecessor.'
							);
						}
						if (predecessor.statutory_contribution_id === input.statutory_contribution_id) {
							refuse('A statutory successor must move onto a different contribution profile.');
						}
						const previousRange = readRange(predecessor.effective_range);
						const successorRange = readRange(input.effective_range);
						if (previousRange == null || successorRange == null) {
							refuse('Both sides of a statutory successor transition need valid effective ranges.');
						}
						if (successorRange.start <= previousRange.start) {
							refuse('A statutory successor must start after its predecessor started.');
						}
						if (previousRange.end != null && previousRange.end < successorRange.start) {
							refuse('The predecessor already ended before this statutory successor begins.');
						}

						yield* api.db.employment_statutory_facts.update(predecessor.id, {
							effective_range: {
								start: previousRange.start,
								end: successorRange.start
							}
						});
						return input;
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited statutory fact so an employment never ends up with two overlapping standings in the same contribution scheme at one instant.',
				handler: ({ input, existing }) => {
					requireId(input.employment_id ?? existing.employment_id, 'an employment');
					requireId(
						input.statutory_contribution_id ?? existing.statutory_contribution_id,
						'a statutory contribution'
					);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
