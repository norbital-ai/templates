import {
	custom,
	defineModel,
	instant,
	numeric,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One person's settlement for one run.
 *
 * Base, proration, statutory and the adjustments are all inlined: base is the contract, proration
 * is the calendar, statutory is arithmetic over the two, and an adjustment names the one captured
 * input that caused it by family and source id. The lock over a captured source is the source's
 * own `settled_payslip_id`; a recurring allowance and a per-period Leave slice keep their capture
 * rows because one entry is consumed by many payslips.
 *
 * The inlined shape is the stored shape. Nothing reshapes it on the way in or out.
 */
export default defineModel(
	{
		payroll_run_id: uuid().notNull(),
		employment_id: uuid().notNull(),
		/** The latest contract date this settlement consumed; employment terms through it are frozen. */
		terms_through: instant({ precision: 'day' }).notNull(),
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
		/**
		 * Everything one captured input caused, in settlement order. Provenance is family + source
		 * id; the source row's `settled_payslip_id` is the lock, this is the money.
		 */
		adjustments: custom('payslip_adjustments')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * When this person was paid. Null until they were.
		 *
		 * **This is the authority on payment, not `payroll_runs.lifecycle`.** Payment is per slip:
		 * one person's pay can settle while a colleague's is still held for a correction, and a run
		 * that had to move as a block made "pay everyone or nobody" the only gesture there was.
		 * `payroll_runs.lifecycle` is derived from these — `PAID` when every slip of the run carries
		 * one — so a reader that means "this whole run is settled" is unchanged, while a reader that
		 * means "this person's pay is settled" reads it here and stops being wrong about a run that
		 * is half paid.
		 *
		 * Set once and never cleared. It is the one column of an otherwise immutable output row that
		 * may move, for the same reason a sealed settings version's holiday source may: paying is an
		 * operational act, not a recalculation, and nothing about the figures changes when it happens.
		 */
		paid_at: instant(),
		gross: numeric().notNull(),
		total_deductions: numeric().notNull(),
		net: numeric().notNull(),
		employer_cost: numeric().notNull(),
		currency: text({ search: true }).notNull()
	},
	{
		description:
			"One person's settlement for one run. Contracted base, the proration segments the calendar produced, the statutory charges over their sum and every adjustment one captured input caused are held here. Year-to-date is a SUM over payslips, never a stored column.",
		recordLabel: ['currency', 'net'],
		icon: 'lucide:receipt',
		indexes: [{ columns: ['payroll_run_id', 'employment_id'], unique: true }]
	}
);
