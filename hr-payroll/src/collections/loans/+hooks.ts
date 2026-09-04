import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

/**
 * The loan is the agreement, and the agreement's honesty is checked here.
 *
 * The loan form nests the schedule in a matrix. Sum-to-principal is a client integrity highlight
 * that blocks submit without rewriting amounts. What this hook holds is the agreement's own
 * edges: the principal is a positive magnitude, and the component it recovers through actually
 * takes entries and settles as a payroll deduction, because a recovery is a deduction by
 * definition.
 *
 * Each repayment row is visible to `loan_repayments` `before` one write at a time. Cross-row
 * shape is not restated here.
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
						api.db.pay_components.findFirst({
							where: {
								id: { eq: String(input.pay_component_id ?? existing?.pay_component_id) }
							},
							columns: { code: true, definition: true, nature: true }
						}),
						(payComponent) => {
							if (payComponent != null) {
								const definition = payComponent.definition;
								if (definition?.source !== 'ENTRY' || definition.settlement !== 'PAYROLL')
									refuse(
										`Loan recoveries settle as payroll deductions, and pay component ${payComponent.code} is not a payroll-settled entry.`
									);
								if (payComponent.nature !== 'DEDUCTION')
									refuse(
										`Loan recoveries settle as deductions, and pay component ${payComponent.code} is a ${payComponent.nature}.`
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
