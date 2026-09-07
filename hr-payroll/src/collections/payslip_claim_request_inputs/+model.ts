import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one claim a payslip consumed, captured as an input.
 *
 * The shape is its siblings': a real cascade FK into the payslip, a real restrict FK into the
 * source, and the denormalized `period` the lock refusal names. See `payslip_work_day_inputs` for
 * the full account of why small junctions exist instead of UUID arrays in JSON.
 *
 * The source carries a global `unique`, which is what the split buys here. A claim is single-use —
 * at most one standing or paid payslip may consume it — and `payslip_component_entry_inputs` could
 * not say so, because it held five families at once and a recurring allowance needs the opposite
 * answer. It recorded that in a comment and left the rule to the gather step. Now four of the five
 * junctions state it as a constraint, and only the allowance omits it.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		claim_request_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one claim a payslip consumed. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the request.',
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id', 'claim_request_id'], unique: true },
			{ columns: ['claim_request_id'], unique: true }
		]
	}
);
