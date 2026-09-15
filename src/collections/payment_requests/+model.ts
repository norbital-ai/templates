import {
	boolean,
	defineModel,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * A one-off payment or deduction: a bonus, notice pay, a separation payment, a correction. Dated by
 * the day it takes effect and explained by its reason; the catalogue row decides direction, band
 * amounts and opt-ins.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The payment type, from the catalogue; its destination, bands and opt-ins price the line. */
		catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the catalogue row's destination/direction. */
		amount: numeric().notNull(),
		/** The day the payment takes effect, which the cutoff reads to place it in a period. */
		effective_on: instant({ precision: 'day' }).notNull(),
		/** Why it is paid: the decision, the agreement or the transaction it makes good. */
		reason: text().notNull(),
		/** The receipt or supporting document. Required when the catalogue row's `evidence` says so. */
		evidence_file: file(),
		/** Settle against the direction the catalogue row declares: a claw-back of an earlier line. */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * The period this settles in, overriding the cutoff's answer. Null is normal: the cutoff
		 * supplies the period from `effective_on`.
		 */
		pay_period: text(),
		/**
		 * The payslip that settled this row. Set by the payroll engine when a run captures the row,
		 * cleared when the draft run is deleted; while set, the row is frozen.
		 */
		payslip_id: uuid(),
		/**
		 * Set when the payroll engine materialised this row from a scheduled catalogue row:
		 * `<catalogue row id>:<occurrence>`. Created with the run, pinned to the payslip it priced;
		 * an unpinned one is the orphan of a deleted draft and is never read as a source.
		 */
		schedule_key: text()
	},
	{
		description:
			'An approved one-off earning or deduction against an employment contract, including bonuses, departure payments and historical corrections. The catalogue defines direction, band amounts and statutory opt-ins.',
		recordLabel: ['reason'],
		icon: 'lucide:wallet',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['catalogue_id'] },
			{ columns: ['employment_id', 'effective_on'] },
			{ columns: ['payslip_id'] },
			{ columns: ['schedule_key'] }
		]
	}
);
