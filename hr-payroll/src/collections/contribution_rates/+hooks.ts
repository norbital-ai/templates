import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/**
 * Contribution bands are pure law transcription, scoped to a statutory profile through their
 * scheme and sealed with it.
 *
 * The two-dimensional selector overlap the database enforces (`contribution_rates_no_overlap`)
 * needs no hook — it fails first with a caller-facing refusal whatever path the write takes. What
 * the hook holds is the **seal**: a band of a scheme whose profile is SEALED or VOIDED refuses
 * create, update and delete, because a rate a paid run was charged under cannot be rewritten.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a contribution band whose scheme belongs to a SEALED or VOIDED statutory profile; bands of a DRAFT profile may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const schemeId = input.statutory_contribution_id ?? existing?.statutory_contribution_id;
						if (schemeId == null)
							refuse('A contribution band states the statutory contribution it belongs to.');
						const scheme = yield* api.db.statutory_contributions.findFirst({
							where: { id: { eq: String(schemeId) } },
							columns: { statutory_profile_id: true }
						});
						if (scheme == null)
							refuse('The statutory contribution this band names does not exist.');
						const profile = yield* api.db.jurisdictions.findFirst({
							where: { id: { eq: scheme.statutory_profile_id } },
							columns: { lifecycle: true }
						});
						if (profile == null)
							refuse('The statutory profile this scheme belongs to does not exist.');
						if (profile.lifecycle !== 'DRAFT')
							refuse(
								'The statutory profile this scheme belongs to is sealed, so its bands are ' +
									'frozen. Enact a new profile version to change the law transcription.'
							);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
