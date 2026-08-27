import { custom, defineModel, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One person's settlement for one run.
 *
 * A payslip comprises four things, and the kind of each is DERIVED from what it points at rather
 * than declared on it:
 *
 *     BASE        from the contract - employment_terms x period.        points at nothing
 *     PRORATION   what the calendar did to base.                        points at nothing
 *     STATUTORY   calculated FROM the two above.                        points at a scheme
 *     ADJUSTMENT  caused by exactly ONE input.                          points at a source
 *
 * The first three are inlined here, because none of them is caused by a record anybody can edit:
 * base is the contract, proration is the calendar, and statutory is arithmetic over the sum of the
 * two. There is nothing to link to, nothing to freeze, and no junction to keep honest. Only
 * `payslip_adjustments` is a relation, and it is the polymorphic one - every row there names the
 * one input that caused it.
 *
 * The inlined shape is the stored shape. Nothing reshapes it on the way in or out.
 */
export default defineModel(
	{
		payroll_run_id: uuid().notNull(),
		employment_id: uuid().notNull(),
		/** The contracted amounts, before the calendar touched them. */
		base: custom('payslip_base', { multiple: true }).notNull(),
		/**
		 * What the calendar did to base, one entry per segment. The segments sum: a joiner, a leaver
		 * or a mid-month salary change splits the period and each part is prorated over the same
		 * full-period denominator.
		 */
		proration: custom('payslip_proration', { multiple: true }).notNull(),
		/** One entry per scheme charged, employee and employer share on the same entry. */
		statutory: custom('payslip_statutory', { multiple: true }).notNull(),
		gross: numeric().notNull(),
		total_deductions: numeric().notNull(),
		net: numeric().notNull(),
		employer_cost: numeric().notNull(),
		currency: text({ search: true }).notNull()
	},
	{
		description:
			"One person's settlement for one run. Contracted base, the proration segments the calendar produced and the statutory charges over their sum are held here; anything caused by one editable input is an adjustment. Year-to-date is a SUM over payslips, never a stored column.",
		recordLabel: ['currency', 'net'],
		icon: 'lucide:receipt',
		indexes: [{ columns: ['payroll_run_id', 'employment_id'], unique: true }]
	}
);
