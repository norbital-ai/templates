import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * Terms are effective-dated: one employment has at most one set of terms in force at any instant.
 *
 * The database is the guarantee — `employment_terms_no_overlap` in +model.ts rejects an overlap
 * with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another row in
 * the same createMany statement. Pod translates that constraint into a caller-facing overlap
 * refusal. A SELECT precheck here would be weaker and add one database round trip per bulk row.
 */
function requireEmployment(value: string | null | undefined): string {
	if (value == null || value === '') {
		return refuse('Employment terms must reference an employment.');
	}
	return value;
}

export default {
	create: {
		before: {
			description:
				'Requires terms to name an employment and refuses a set whose effective range overlaps terms already in force, so payroll never finds two salaries or work patterns for one person on one day.',
			handler: async ({ input }) => {
				requireEmployment(input.employment_id);
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Re-checks edited terms so extending or moving their effective range cannot leave an employment with two sets of terms in force at the same instant.',
			handler: async ({ input, existing }) => {
				requireEmployment(input.employment_id ?? existing.employment_id);
				return input;
			}
		}
	}
} satisfies Hooks;
