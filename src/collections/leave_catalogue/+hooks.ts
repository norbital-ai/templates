import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { compileEligibility } from '../payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/**
 * The catalogue row is the whole mechanism: its eligibility expression decides who gets an
 * entitlement and its bands decide how much. A malformed expression is refused here, the same way
 * a bad formula is; a statutory row cites the law it transcribes. The row belongs to one
 * jurisdiction settings version and is sealed with it: once the version is sealed no create, edit
 * or delete reaches it. An edit to a draft that changes what an open entitlement is owed is settled
 * by the reconciler (`ADJUSTMENT`, keyed by the row's `updated_at`), which the after hook starts
 * for every company on the lineage.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write once the jurisdiction settings version is sealed; compiles the eligibility expression against the person context and requires a citation on a statutory row.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						yield* refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Leave ${String(row.code ?? '')}`
						);
						const problem = compileEligibility(row.eligibility);
						if (problem != null) refuse(problem);
						if (row.is_statutory === true && String(row.authority ?? '').trim() === '')
							refuse('A statutory leave cites the section of law it transcribes.');
						return input;
					})
			},
			after: {
				description:
					"An edit to a draft catalogue settles every open entitlement of the companies on the lineage: the reconciler posts the delta once, keyed by the row's updated_at.",
				handler: ({ record, changes, api }): Effect.Effect<void> =>
					Effect.gen(function* () {
						if (record.approval_id != null || Object.keys(changes).length === 0) return;
						const version = yield* api.db.jurisdiction_settings.findFirst({
							where: { id: { eq: record.settings_id } },
							columns: { code: true }
						});
						if (version == null) return;
						yield* api.automations.run('leave_ledger_refresh', { settings_code: version.code });
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a leave once its jurisdiction settings version is sealed; a type with entitlements on it is history and the restrict edge refuses the delete.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Leave ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
