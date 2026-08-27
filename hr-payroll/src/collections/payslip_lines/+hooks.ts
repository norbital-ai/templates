import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/** A payslip line may only be removed while the run that produced it is still DRAFT. */
export default {
	delete: {
		perRecord: {
			before: {
				description:
					'Blocks removing a payslip line once the payroll run behind its payslip has left DRAFT, so a paid payslip keeps every line that made up its total.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						const payslip = yield* api.db.payslips.findFirst({
							where: { id: { eq: existing.payslip_id } }
						});
						if (!payslip) {
							refuse('A payslip line cannot be deleted without its payslip.');
						}
						const run = yield* api.db.payroll_runs.findFirst({
							where: { id: { eq: payslip.payroll_run_id } }
						});
						if (!run) {
							refuse('A payslip line cannot be deleted without its payroll run.');
						}
						if (run.lifecycle !== 'DRAFT') {
							refuse(
								`Payroll run ${run.period} is ${run.lifecycle}. Payslip lines can only be deleted while the run is DRAFT.`
							);
						}
					})
			}
		}
	}
} satisfies Hooks;
