import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * A child fact is an append-only personal fact, and the scaling statutory leave floors compute
 * against it.
 *
 * - **Update refuses outright**: a correction appends a row whose `supersedes_id` names the fact
 *   it fixes, so what was believed at every point stays on the record and a paid run's floor is
 *   reconstructable from immutable facts as of its own date.
 * - **Delete refuses**: a fact a derived balance has ever consumed is history; supersede instead.
 * - The birth date is immutable by being stated once at creation; the age cutoffs laws state
 *   (`under 7`, `under 18`) are computed from it as of each date.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating or deleting a child fact — corrections append a superseding row, so the facts a derived leave balance was computed from stay immutable.',
				handler: ({ input, existing }) => {
					if (existing !== undefined)
						refuse(
							'A child fact is an append-only record and cannot be edited or deleted. ' +
								'Append a fact whose supersedes_id names this one.'
						);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
