import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one loan repayment a payslip consumed, captured as an input.
 *
 * This is the storage for `payslip.inputs.loan_repayments`, over the same shape as its three
 * sibling junctions: a real cascade FK into the payslip, a real restrict FK into the source, and
 * the denormalized `period` the lock refusal names. See `payslip_work_day_inputs` for the full
 * account of why four small junctions exist instead of UUID arrays in JSON.
 *
 * A repayment can appear on several payslips when net-pay protection prevents full recovery — which
 * is why `loan_repayment_id` carries no global unique index. What bounds it is arithmetic the
 * engine owns: paid recovery adjustments across every payslip may never exceed the repayment's
 * amount due. The restrict edge is also what protects a loan's history: deleting the loan would
 * cascade its repayments, and this edge refuses while any of them is captured.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		loan_repayment_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one loan repayment a payslip consumed. No user policy grants writes on this collection; the payroll engine writes it as part of the run that recovered the repayment.',
		icon: 'lucide:link',
		indexes: [
			// Composite only. Net-pay protection can part-recover a repayment, and the next period
			// recaptures the same row for the remainder. Same-payslip duplicates stop here.
			{ columns: ['payslip_id', 'loan_repayment_id'], unique: true }
		]
	}
);
