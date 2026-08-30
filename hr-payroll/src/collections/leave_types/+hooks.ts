import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/**
 * Leave types are catalogue rows scoped to a statutory profile and sealed with it.
 *
 * The profile's period is when the version governs — per-row effective dating is gone, and with it
 * the end-date-plus-successor ritual. What the hooks hold is the **seal**: a catalogue row of a
 * SEALED or VOIDED profile refuses create, update and delete. The statutory floor a leave type
 * merges is the profile's own `statutory_leave` member, so a sealed profile's leave catalogue is
 * exactly as immutable as the law it transcribes.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a catalogue row whose statutory profile is SEALED or VOIDED; rows of a DRAFT profile may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) => {
					const profileId = input.statutory_profile_id ?? existing?.statutory_profile_id;
					if (profileId == null) refuse('A leave type states the statutory profile it belongs to.');
					return Effect.flatMap(
						api.db.jurisdictions.findFirst({
							where: { id: { eq: String(profileId) } },
							columns: { lifecycle: true, statutory_leave: true }
						}),
						(profile) => {
							if (profile == null)
								refuse('The statutory profile this leave type names does not exist.');
							if (profile.lifecycle !== 'DRAFT')
								refuse(
									'The statutory profile this leave type belongs to is sealed, so its catalogue ' +
										'is frozen. Enact a new profile version to change the catalogue.'
								);
							// A stated kind must be one the profile's statutory leave member actually floors;
							// a kind the profile does not answer would merge a floor from nothing.
							const kind = input.statutory_kind ?? existing?.statutory_kind;
							if (kind != null) {
								const stated = profile.statutory_leave.some((member) => member.kind === kind);
								if (!stated)
									refuse(
										`The statutory profile states no floor for statutory leave kind ${kind}. ` +
											'Add the kind to the profile, or leave the type without a statutory kind.'
									);
							}
							return Effect.succeed(input);
						}
					);
				}
			}
		}
	}
} satisfies Hooks;
