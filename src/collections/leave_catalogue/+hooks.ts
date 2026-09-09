import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { compileEligibility } from '../payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/** Sealed catalogue revisions remain the historical rules used by entitlement queries. */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write once the jurisdiction settings version is sealed; compiles the eligibility expression and every entitlement band predicate against the person context and requires a citation on a statutory row.',
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
						for (const band of row.entitlement?.bands ?? []) {
							const bandProblem = compileEligibility(band.eligibility);
							if (bandProblem != null) refuse(`Entitlement band: ${bandProblem}`);
						}
						if (row.is_statutory === true && String(row.authority ?? '').trim() === '')
							refuse('A statutory leave cites the section of law it transcribes.');
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a leave once its jurisdiction settings version is sealed; entries retain their original catalogue revision.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Leave ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
