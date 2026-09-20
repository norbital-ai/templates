import {
	custom,
	defineModel,
	enums,
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
 * own `payslip_id`; a recurring allowance and a per-period Leave slice materialise as per-period
 * entries because one source is consumed by many payslips.
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
		 * id; the source row's `payslip_id` is the lock, this is the money.
		 */
		adjustments: custom('payslip_adjustments')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Where this person's settlement stands.
		 *
		 * `DRAFT` is the freshly computed slip: it may be recalculated by rebuilding its run and
		 * deleted while it stands. `ON_HOLD` is a reviewed slip deliberately kept out of the bank
		 * file — a dispute, a missing bank detail — and it can be released back to `DRAFT`.
		 * `PAID` is terminal: money has left, the slip can never be deleted, and a correction is a
		 * component entry in a later draft run.
		 */
		status: enums(['DRAFT', 'ON_HOLD', 'PAID']).notNull().default('DRAFT'),
		/** Settlement date, required with PAID and immutable afterward, including for zero cash pay. */
		paid_at: instant(),
		gross: numeric().notNull(),
		total_deductions: numeric().notNull(),
		net: numeric().notNull(),
		/** Employee statutory liability not covered by this payroll's funds; no automatic future recovery. */
		unfunded_contributions: numeric()
			.notNull()
			.default(sql`0`),
		/** Employee funds received outside payroll against the calculated shortfall. */
		funding_received: numeric()
			.notNull()
			.default(sql`0`),
		funding_received_on: instant({ precision: 'day' }),
		funding_reference: text(),
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
