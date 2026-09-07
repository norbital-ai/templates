import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

/**
 * The loan is the agreement, and the agreement's honesty is checked here.
 *
 * The loan form nests the schedule in a matrix, and blocks submit on any of the three things
 * `loanScheduleRefusals` states about a schedule. What this hook holds is the agreement's own
 * edges: the principal is a positive magnitude, and the component it recovers through actually
 * takes entries and settles as a payroll deduction, because a recovery is a deduction by
 * definition.
 *
 * The schedule's own shape is refused by `loan_repayments` `mutate.prepare`, which is the only
 * hook coordinate handed a whole batch. It is not restated here, and could not be: a loan write
 * is never shown the repayment rows nested under it.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a loan whose principal is not a positive magnitude, or whose recovery component is not a payroll-settled deduction entry.',
				handler: ({ input, existing, api }) => {
					const principal = decodeNumber(
						input.principal != null ? input.principal : (existing?.principal ?? 0)
					);
					if (!(principal > 0)) refuse('A loan principal is a positive magnitude.');
					return Effect.map(
						api.db.component_catalogue.findFirst({
							where: {
								id: { eq: String(input.component_catalogue_id ?? existing?.component_catalogue_id) }
							},
							columns: { code: true, definition: true, nature: true }
						}),
						(catalogueComponent) => {
							if (catalogueComponent != null) {
								const definition = catalogueComponent.definition;
								if (definition?.source !== 'ENTRY' || definition.settlement !== 'PAYROLL')
									refuse(
										`Loan recoveries settle as payroll deductions, and component ${catalogueComponent.code} is not a payroll-settled entry.`
									);
								if (catalogueComponent.nature !== 'DEDUCTION')
									refuse(
										`Loan recoveries settle as deductions, and component ${catalogueComponent.code} is a ${catalogueComponent.nature}.`
									);
							}
							return input;
						}
					);
				}
			}
		}
	}
} satisfies Hooks;
