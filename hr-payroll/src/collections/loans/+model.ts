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
 * The agreement. A staff loan, a salary advance, an overpayment to be recovered.
 *
 * The loan is not an input to payroll and payroll never reads it: one amount due under the
 * agreement is an input, and that is a `loan_repayments` row. Splitting the two is the whole point
 * of this pair — the removed `obligations` collection fused an agreement with the amounts due
 * under it, which is why a loan's schedule had to be recovered against the agreement as a whole
 * and a part-recovered repayment could not be named.
 *
 * The loan owns its repayment rows, so deleting an unused loan cascades its schedule away with it.
 * Once a repayment is captured by a payroll run, the input junction's `restrict` edge blocks that
 * cascade and protects the recovery history; the loan itself stays editable as an agreement, but
 * its settled repayments do not.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		pay_component_id: uuid().notNull(),
		/** A positive magnitude, stated once here rather than repeated across the schedule. */
		principal: numeric().notNull(),
		/** The window the agreement is live across; its last repayment must fall inside it. */
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/**
		 * The agreement's start as a scalar instant, generated from the range.
		 *
		 * A live query is keyed by its ordering values, and a range is not a scalar: ordering the loan
		 * tables by `effective_range` passed planning and then failed every row, and the page sat on
		 * "Reconnecting to live updates". The tables order by this column instead; `bolt_instant`
		 * anchors the canonical day at UTC midnight through the immutable function the platform installs
		 * before migrations run, as `leave_requests.from_date` already does.
		 */
		effective_from: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(effective_range ->> 'start')`
		),
		/** The customer's own name for the loan — a reference, a batch number. */
		reference: text({ search: true }),
		/** Why the loan exists. */
		reason: text()
	},
	{
		description:
			'One staff loan, salary advance or overpayment recovery agreement. The loan is the agreement; the amounts due under it are loan_repayments rows, which is what payroll consumes.',
		recordLabel: ['reference', 'principal'],
		icon: 'lucide:hand-coins',
		indexes: [{ columns: ['employment_id'] }, { columns: ['pay_component_id'] }]
	}
);
