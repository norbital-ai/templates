import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one standing allowance a payslip consumed, captured as an input.
 *
 * The shape is its siblings': a real cascade FK into the payslip, a real restrict FK into the
 * source, and the denormalized `period` the lock refusal names. See `payslip_work_day_inputs` for
 * the full account of why small junctions exist instead of UUID arrays in JSON.
 *
 * This is the one capture junction with **no** unique on its source, and the reason the other four
 * can have one. A recurring allowance is an input to several payslips — one per period its window
 * covers — so the single-use rule that holds for every other family is false here. Holding both
 * answers in one table is what forced that rule out of the database and into a hook comment.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		allowance_request_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one standing allowance a payslip consumed. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the request.',
		icon: 'lucide:link',
		indexes: [{ columns: ['payslip_id', 'allowance_request_id'], unique: true }]
	}
);
