import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import { compileEligibility } from '../payroll_runs/lib/eligibility.js';
import type { Hooks } from './$types.js';

/**
 * Statutory schemes are rows of one jurisdiction settings version and are sealed with it.
 *
 * The version's period is when the scheme governs; per-scheme effective dating is gone. What the
 * hook holds is the **seal**: a scheme of a sealed version refuses create, update and delete,
 * because a contribution rule a paid run was charged under cannot be rewritten. A change of law
 * is a new version of the settings.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a scheme whose jurisdiction settings version is sealed; schemes of a draft may be prepared and edited until the seal. Requires a citation on a statutory scheme; compiles the scheme and band eligibility predicates.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						yield* refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Scheme ${String(row.code ?? '')}`
						);
						if (row.is_statutory === true && String(row.authority ?? '').trim() === '')
							refuse('A statutory scheme cites the section of law it transcribes.');
						const schemeFault = compileEligibility(row.eligibility);
						if (schemeFault != null) refuse(`Scheme ${String(row.code ?? '')}: ${schemeFault}`);
						for (const [index, band] of (row.bands ?? []).entries()) {
							const fault = compileEligibility(band.eligibility);
							if (fault != null) refuse(`Band ${index + 1}: ${fault}`);
						}
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuses deleting a scheme whose jurisdiction settings version is sealed.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Scheme ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
