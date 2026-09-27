import { automation } from '@norbital-ai/bolt';
import { exitSettlementOutput, settleExit } from '../lib/leave/exit-settlement.js';

/**
 * On a departure (the end of `effective_range`, its reason or its facts changed), settles it when due: unused leave
 * encashment and eligible separation payments for HR approval, and the exit clearance hold. A future departure is
 * recorded on the contract for the daily catch-up. Dismissals require review; the reason alone never establishes
 * forfeiture. Existing requests are skipped on retry.
 */
const leave_encashment_on_exit = automation({
	description:
		'On or after departure, submits unused leave encashment and eligible separation payments for HR approval. Future departures are deferred to the daily check. Dismissals require review; the departure reason alone does not establish forfeiture. Existing requests are skipped on retry.',
	on: { updated: 'employments', fields: ['effective_range', 'exit_reason', 'exit_facts'] },
	input: {
		ids: { kind: 'list', of: { kind: 'id', of: 'employments' }, optional: true },
		/** The contract to settle, when started by hand. */
		employment_id: { kind: 'id', of: 'employments', optional: true }
	},
	output: { kind: 'list', of: exitSettlementOutput },
	runAs: ['leave_encashment_on_exit_automation']
});
export default leave_encashment_on_exit;

leave_encashment_on_exit.run(async (input, ctx) => {
	const ids = [...(input.ids ?? []), ...(input.employment_id == null ? [] : [input.employment_id])];
	const out = [];
	for (const id of ids) out.push(await settleExit(ctx, id));
	return out;
});
