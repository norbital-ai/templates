import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/**
 * Pay components are catalogue rows scoped to a statutory profile and sealed with it.
 *
 * There is no per-row effective dating left: the profile's period is when the version governs, and
 * versioning replaces the end-date-plus-successor ritual a range demanded. What the hooks hold is
 * the **seal**: a catalogue row of a SEALED or VOIDED profile refuses create, update and delete —
 * the configuration a paid run was made of cannot change, and a change to the catalogue is a new
 * profile version enacted through the approval flow.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a catalogue row whose statutory profile is SEALED or VOIDED; rows of a DRAFT profile may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) => {
					const profileId = input.statutory_profile_id ?? existing?.statutory_profile_id;
					if (profileId == null)
						refuse('A pay component states the statutory profile it belongs to.');
					return Effect.flatMap(
						api.db.jurisdictions.findFirst({
							where: { id: { eq: String(profileId) } },
							columns: { lifecycle: true }
						}),
						(profile) => {
							if (profile == null)
								refuse('The statutory profile this component names does not exist.');
							if (profile.lifecycle !== 'DRAFT')
								refuse(
									'The statutory profile this component belongs to is sealed, so its catalogue ' +
										'is frozen. Enact a new profile version to change the catalogue.'
								);
							return Effect.succeed(input);
						}
					);
				}
			}
		}
	}
} satisfies Hooks;
