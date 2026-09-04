import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { readRange } from '../payroll_runs/lib/effective.js';

/**
 * One employment has at most one standing with one statutory scheme at any instant.
 *
 * The database is the guarantee — `employment_statutory_facts_no_overlap` in +model.ts rejects an
 * overlap with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another
 * row in the same batched mutate statement. Bolt translates that constraint into a caller-facing
 * overlap refusal. A SELECT precheck would be weaker and add one database round trip per bulk row.
 */
function requireId(value: string | null | undefined, what: string): string {
	if (value == null || value === '') {
		return refuse(`A statutory fact must reference ${what}.`);
	}
	return value;
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Requires both references and, for a system successor, validates and stages the predecessor close into the same approval graph. On an edit it re-checks both references so an employment never ends up with two overlapping standings in one contribution scheme.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						requireId(input.employment_id ?? existing?.employment_id, 'an employment');
						requireId(
							input.statutory_contribution_id ?? existing?.statutory_contribution_id,
							'a statutory contribution'
						);
						// Closing the predecessor is a create-time transition and nothing else: by the time a
						// successor is edited its predecessor was already closed, so re-staging the close would
						// move an end date that a later fact may already sit against.
						if (existing !== undefined || input.supersedes_fact_id == null) return input;

						const predecessor = yield* api.db.employment_statutory_facts.findFirst({
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

						yield* api.db.employment_statutory_facts.mutate([
							{
								id: predecessor.id,
								effective_range: {
									start: previousRange.start,
									end: successorRange.start
								}
							}
						]);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
