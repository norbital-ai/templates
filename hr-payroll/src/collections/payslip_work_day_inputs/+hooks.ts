import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * Engine-owned capture of one work day a payslip read.
 *
 * There is no user write path and no legitimate update: the payroll engine states these rows as
 * part of the run's single declarative payload, and a recalculation deletes the prior build's
 * captures and creates new ones in the same statement. No policy grants any write on this
 * collection, and this hook is the second lock — an edit of a stored capture would quietly move
 * the settlement lock a run holds over its inputs.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating a captured input. Captures are created and replaced by the payroll engine only.',
				handler: ({ input, existing }) => {
					// Only an edit can touch a stored capture, and edits always refuse: the engine
					// replaces captures by deleting and creating, never by patching.
					if (existing !== undefined)
						refuse(
							'A captured input is engine output and cannot be edited. Recalculate the draft ' +
								'run that holds it.'
						);
					return input;
				}
			}
		}
	}
} satisfies Hooks;
