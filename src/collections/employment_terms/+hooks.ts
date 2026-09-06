import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * Terms are effective-dated: one employment has at most one set of terms in force at any instant.
 *
 * The database is the guarantee — `employment_terms_no_overlap` in +model.ts rejects an overlap
 * with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another row in
 * the same batched mutate statement. Bolt translates that constraint into a caller-facing overlap
 * refusal. A SELECT precheck here would be weaker and add one database round trip per bulk row.
 */
function requireEmployment(value: string | null | undefined): string {
	if (value == null || value === '') {
		return refuse('Employment terms must reference an employment.');
	}
	return value;
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Requires terms to name an employment and refuses a set whose effective range overlaps terms already in force, so payroll never finds two salaries or work patterns for one person on one day. Re-checked on every edit, because extending or moving a range can put two sets in force at one instant.',
				handler: ({ input, existing }) => {
					// `existing` is undefined on a create, which is exactly how the two are told apart: an
					// edit that does not restate the employment keeps the one already stored.
					requireEmployment(input.employment_id ?? existing?.employment_id);
					return input;
				}
			},
			after: {
				description:
					"Terms decide eligibility, so the employment's leave entitlements are regenerated once they commit.",
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						yield* api.automations.run('leave_ledger_refresh', {
							employment_ids: [record.employment_id]
						});
					})
			}
		}
	}
} satisfies Hooks;
