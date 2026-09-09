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
 * the day it takes effect and explained by its reason; the catalogue row decides direction, ceiling
 * and treatments.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The payment type, from the catalogue; its nature, ceiling and treatments price the line. */
		payment_catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the catalogue row's nature. */
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
		 * The payslip that settled this row, and the period it belongs to. Set by the payroll engine
		 * when a run captures the row, cleared when a draft run is deleted; while set, the row is
		 * frozen. The period is written beside the id so a refusal or a badge can name it without a
		 * `payroll_runs` read grant.
		 */
		settled_payslip_id: uuid(),
		settled_period: text()
	},
	{
		description:
			'An approved one-off earning or deduction against an employment contract, including bonuses, departure payments and historical corrections. The catalogue defines direction and contribution treatments.',
		recordLabel: ['reason'],
		icon: 'lucide:wallet',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['payment_catalogue_id'] },
			{ columns: ['employment_id', 'effective_on'] }
		]
	}
);
