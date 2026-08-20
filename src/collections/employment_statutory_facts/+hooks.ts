import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

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
					'Requires a statutory fact to name both its employment and its contribution scheme, and refuses one whose effective range overlaps an existing standing for that same employment and scheme.',
				handler: async ({ input }) => {
					requireId(input.employment_id, 'an employment');
					requireId(input.statutory_contribution_id, 'a statutory contribution');
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited statutory fact so an employment never ends up with two overlapping standings in the same contribution scheme at one instant.',
				handler: async ({ input, existing }) => {
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
