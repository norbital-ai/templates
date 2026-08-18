import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * Results belong to their run. Once a run has been calculated or paid its payslips are the record of
 * what was settled; a correction is a compensating entry in a later run, not a deletion.
 */
export default {
	delete: {
		before: {
			description:
				'Blocks deleting a payslip once its payroll run has left DRAFT, so what was paid to a person stays on the record and is corrected by an entry in a later run.',
			handler: ({ existing, api }) =>
				Effect.gen(function* () {
					const run = yield* api.db.query.payroll_runs.findFirst({
						where: { norbital_id: { eq: existing.payroll_run_id } }
					});
					if (!run) {
						refuse('A payslip cannot be deleted without its payroll run.');
					}
					if (run.lifecycle !== 'DRAFT') {
						refuse(
							`Payroll run ${run.period} is ${run.lifecycle}. Payslips can only be deleted while the run is DRAFT.`
						);
					}
				})
		}
	}
} satisfies Hooks;
