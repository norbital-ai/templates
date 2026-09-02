import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one leave request a payslip read, captured as an input.
 *
 * This is the storage for `payslip.inputs.leave_requests`, over the same shape as its three
 * sibling junctions: a real cascade FK into the payslip, a real restrict FK into the source, and
 * the denormalized `period` the lock refusal names. See `payslip_work_day_inputs` for the full
 * account of why four small junctions exist instead of UUID arrays in JSON.
 *
 * One approved request may cross payroll windows and legitimately appear on more than one payslip,
 * which is exactly why `leave_request_id` carries no global unique index: the days each payslip
 * records are the days that fall inside its own window.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		leave_request_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one leave request a payslip read. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the request.',
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id', 'leave_request_id'], unique: true },
			// A source is consumed by at most one payslip, ever. The composite above only stops the
			// same source appearing twice on the SAME payslip; nothing stopped a second payslip
			// claiming it, so "paid once" rested on engine behaviour rather than on the database.
			{ columns: ['leave_request_id'], unique: true }
		]
	}
);
