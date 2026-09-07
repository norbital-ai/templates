import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { restateEmploymentFor } from '../../lib/leave/service.js';
import { readLeaveContext, type LeaveContext } from '../../lib/leave/entitlements.js';

/**
 * Terms are effective-dated: one employment has at most one set of terms in force at any instant.
 *
 * The database is the guarantee: `employment_terms_no_overlap` in +model.ts rejects an overlap
 * with SQLSTATE 23P01 whatever path the write takes, including a concurrent one or another row in
 * the same batched mutate statement. Bolt translates that constraint into a caller-facing overlap
 * refusal. A SELECT precheck here would be weaker and add one database round trip per bulk row.
 *
 * Terms decide eligibility (salary, classification, employment type), so a set of terms and the
 * ledger it implies commit together: `before` plans the employment with the pending terms in hand
 * and restates the employment root through `api.db.employments.mutate`, staged into this same
 * graph as the workspace's own work; see `employee_children/+hooks.ts`.
 */
function requireEmployment(value: string | null | undefined): string {
	if (value == null || value === '') {
		return refuse('Employment terms must reference an employment.');
	}
	return value;
}

export default {
	mutate: {
		prepare: ({ inputs, api }): Effect.Effect<{ readonly context: LeaveContext }> =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((one) => (one.id == null ? [] : [one.id]));
				// An edit may leave the employment unstated; it is read off the stored terms.
				const stored =
					ids.length === 0
						? []
						: yield* api.db.employment_terms.findMany({
								where: { id: { in: ids } },
								columns: { id: true, employment_id: true },
								limit: ids.length
							});
				const context = yield* readLeaveContext(
					api,
					[...inputs, ...stored].flatMap((one) =>
						one.employment_id == null ? [] : [one.employment_id]
					),
					{}
				);
				return { context };
			}),
		perRecord: {
			before: {
				description:
					'Requires terms to name an employment and refuses a set whose effective range overlaps terms already in force, so payroll never finds two salaries or work patterns for one person on one day. Re-checked on every edit, because extending or moving a range can put two sets in force at one instant. Restates the employment with the entitlements these terms decide, in the same commit.',
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						// `existing` is undefined on a create, which is exactly how the two are told apart: an
						// edit that does not restate the employment keeps the one already stored.
						const employmentId = requireEmployment(input.employment_id ?? existing?.employment_id);
						yield* restateEmploymentFor(api, prepared.context, 'employment_terms', {
							...existing,
							...input,
							id: recordId,
							employment_id: employmentId,
							approval_id: null
						});
						return input;
					})
			}
		}
	}
} satisfies Hooks<{ readonly context: LeaveContext }>;
