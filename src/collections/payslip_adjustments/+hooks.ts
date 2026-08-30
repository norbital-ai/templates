import { Effect } from 'effect';
import { refuse, type MutateBeforeContext } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * The two rules the adjustment's FK shape cannot state by itself.
 *
 * 1. **The captured input must belong to the same payslip.** The `input` reference proves the link
 *    exists; it cannot prove whose payslip it is an input of. An adjustment is an output of one
 *    payslip, and an output whose cause sits on a different payslip is a misstatement of provenance
 *    the engine never produces — it joins adjustments to the junction rows it emits under the same
 *    parent — so this hook exists for the direct write that bypasses the engine.
 *
 * 2. **A statutory rule key is work-day provenance and nothing else.** Only a work-day input is
 *    priced by a rule of the run's statutory snapshot; a component entry, a leave request or a loan
 *    repayment reaches its meaning through the component or the repayment itself, so a rule key on
 *    any other arm is a second, competing provenance.
 *
 * Nested creates carry no `payslip_id` of their own at hook time — the runtime assigns ownership
 * from the parent they are nested under — so there is nothing for the proof to compare against and
 * the first rule is silent exactly where it cannot apply.
 */

/** The junction row's owner, read through whichever arm the reference names. */
function samePayslip(
	api: MutateBeforeContext<Hooks>['api'],
	input: { readonly payslip_id?: string | null; readonly input?: unknown }
): Effect.Effect<void, never, never> {
	const handle = input.input;
	if (handle == null || input.payslip_id == null) return Effect.void;
	if (typeof handle !== 'object') return Effect.void;
	const kind = Reflect.get(handle, 'kind');
	const id = Reflect.get(handle, 'id');
	if (typeof id !== 'string' || id === '') return Effect.void;
	const ownerOf = (): Effect.Effect<{ payslip_id: string | null } | undefined, never, never> => {
		switch (kind) {
			case 'WORK_DAY_INPUT':
				return api.db.payslip_work_day_inputs.findFirst({
					where: { id: { eq: id } },
					columns: { payslip_id: true }
				});
			case 'COMPONENT_ENTRY_INPUT':
				return api.db.payslip_component_entry_inputs.findFirst({
					where: { id: { eq: id } },
					columns: { payslip_id: true }
				});
			case 'LEAVE_REQUEST_INPUT':
				return api.db.payslip_leave_request_inputs.findFirst({
					where: { id: { eq: id } },
					columns: { payslip_id: true }
				});
			case 'LOAN_REPAYMENT_INPUT':
				return api.db.payslip_loan_repayment_inputs.findFirst({
					where: { id: { eq: id } },
					columns: { payslip_id: true }
				});
			default:
				return Effect.succeed(undefined);
		}
	};
	return Effect.flatMap(ownerOf(), (link) => {
		if (link === undefined) return Effect.void;
		if (link.payslip_id !== input.payslip_id)
			refuse(
				'The captured input this adjustment names belongs to a different payslip. ' +
					'An adjustment is caused by the input its own payslip captured.'
			);
		return Effect.void;
	});
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses updating an adjustment outright, refuses an adjustment whose captured input link belongs to another payslip, and refuses a statutory rule key on any arm but a work-day input.',
				handler: ({ input, existing, api }) => {
					// An adjustment is engine output: created and replaced with its payslip, never
					// edited. A recalculation deletes the prior graph and creates this one fresh, so
					// no legitimate write path patches a stored row.
					if (existing !== undefined)
						refuse(
							'An adjustment is engine output and cannot be edited. Recalculate its draft ' +
								'run, or correct a paid one with a component entry in a later draft run.'
						);
					const ruleKey = input.statutory_rule_key;
					const kind =
						input.input != null && typeof input.input === 'object'
							? Reflect.get(input.input, 'kind')
							: undefined;
					if (ruleKey != null && kind !== 'WORK_DAY_INPUT')
						refuse(
							'A statutory rule key is provenance of a work-day adjustment. Component entries, ' +
								'leave requests and loan repayments are not priced by a statutory rule.'
						);
					return Effect.as(samePayslip(api, input), input);
				}
			}
		}
	}
} satisfies Hooks;
