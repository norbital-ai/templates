import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/**
 * Statutory schemes are pure law transcription, scoped to a statutory profile and sealed with it.
 *
 * The profile's period is when the version governs — per-scheme effective dating is gone. What the
 * hook holds is the **seal**: a scheme of a SEALED or VOIDED profile refuses create, update and
 * delete, because a contribution rule a paid run was charged under cannot be rewritten. A change
 * of law enacts a new profile version through the approval flow.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a scheme whose statutory profile is SEALED or VOIDED; schemes of a DRAFT profile may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) => {
					const profileId = input.statutory_profile_id ?? existing?.statutory_profile_id;
					if (profileId == null)
						refuse('A statutory contribution states the statutory profile it belongs to.');
					return Effect.flatMap(
						api.db.jurisdictions.findFirst({
							where: { id: { eq: String(profileId) } },
							columns: { lifecycle: true }
						}),
						(profile) => {
							if (profile == null)
								refuse('The statutory profile this scheme names does not exist.');
							if (profile.lifecycle !== 'DRAFT')
								refuse(
									'The statutory profile this scheme belongs to is sealed, so its schemes are ' +
										'frozen. Enact a new profile version to change the law transcription.'
								);
							return Effect.succeed(input);
						}
					);
				}
			}
		}
	}
} satisfies Hooks;
