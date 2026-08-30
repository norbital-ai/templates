import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * A payslip is engine output, and output is create-and-delete, never edit.
 *
 * The engine builds a run inside `payroll_runs` hooks and returns it as one declarative payload;
 * a recalculation deletes the previous build's rows and creates new ones in the same statement, so
 * no legitimate write path ever patches a stored payslip. No policy grants `mutate.existing` on this
 * collection, and this hook is the second lock: even a mis-granted direct write refuses here,
 * because a settled figure that can be quietly edited is not a settled figure.
 *
 * Deletion keeps its own guard — a payslip may leave with a draft recalculation, and never
 * after the run has been paid.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating a payslip. Output rows are created and replaced by the payroll engine only; a correction is a component entry in a later draft run.',
				handler: ({ input, existing }) => {
					if (existing !== undefined)
						refuse(
							'A payslip is engine output and cannot be edited. Recalculate its draft run, or ' +
								'correct a paid one with a component entry in a later draft run.'
						);
					return input;
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Blocks deleting a payslip once its payroll run has left DRAFT, so what was paid to a person stays on the record and is corrected by an entry in a later run.',
				handler: ({ existing, api }) =>
					Effect.map(
						api.db.payroll_runs.findFirst({
							where: { id: { eq: existing.payroll_run_id } }
						}),
						(run) => {
							if (!run) {
								refuse('A payslip cannot be deleted without its payroll run.');
							}
							if (run.lifecycle !== 'DRAFT') {
								refuse(
									`Payroll run ${run.period} is ${run.lifecycle}. Payslips can only be deleted while the run is DRAFT.`
								);
							}
						}
					)
			}
		}
	}
} satisfies Hooks;
