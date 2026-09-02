import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one component entry a payslip consumed, captured as an input.
 *
 * This is the storage for `payslip.inputs.component_entries`, over the same shape as its three
 * sibling junctions: a real cascade FK into the payslip, a real restrict FK into the source, and
 * the denormalized `period` the lock refusal names. See `payslip_work_day_inputs` for the full
 * account of why four small junctions exist instead of UUID arrays in JSON.
 *
 * There is deliberately NO global unique index over `component_entry_id`. A recurring allowance is
 * an input to several payslips — one per period its range covers — while a one-off claim, bonus,
 * arrears entry or manual correction is single-use: at most one standing/paid payslip may capture
 * it. That variant rule is the engine's and the gather step's named refusal, not a database
 * constraint, because the two halves of the family need opposite answers.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		component_entry_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one component entry a payslip consumed. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the entry.',
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id', 'component_entry_id'], unique: true },
			// A source is consumed by at most one payslip, ever. The composite above only stops the
			// same source appearing twice on the SAME payslip; nothing stopped a second payslip
			// claiming it, so "paid once" rested on engine behaviour rather than on the database.
			{ columns: ['component_entry_id'], unique: true }
		]
	}
);
