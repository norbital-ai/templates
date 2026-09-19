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
 * One instance of an ad hoc class: a bonus granted, back pay owed, a separation payment raised
 * on the last day. Due whole in one pay period — never prorated, never repeated. HR raises one
 * from the Events page; off-boarding raises the `SEPARATION` classes the leaver is eligible for.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The ad hoc class, from the catalogue; its destination, bands and memberships price the line. */
		catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced catalogue's destination/direction. */
		amount: numeric().notNull(),
		/**
		 * The day the payment is for: the grant, the last day of service, the month the back pay
		 * makes good. The cutoff places it in a period, and the class's bands and eligibility are
		 * read over the person as of this day.
		 */
		event_date: instant({ precision: 'day' }).notNull(),
		/** Why it is paid: the decision, the agreement or the transaction it makes good. */
		reason: text().notNull().default(''),
		/** The receipt or decision. Required when the catalogue row's `evidence` says so. */
		evidence_file: file(),
		/**
		 * Settle this one against the direction its catalogue declares, rather than with it: a
		 * claw-back of a bonus is a bonus request with this set, under the same catalogue, on the
		 * same payslip line.
		 */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * The period this settles in, overriding the cutoff's answer. Null is normal: the cutoff
		 * supplies the period from `event_date`.
		 */
		pay_period: text(),
		/**
		 * The payslip that settled this row. Set by the payroll engine when a run captures the row,
		 * cleared when the draft run is deleted; while set, the row is frozen.
		 */
		payslip_id: uuid()
	},
	{
		description:
			'A one-off payment or deduction a person is owed in one pay period: the ad hoc class, the amount and the day it is for. The amount is a positive magnitude; direction comes from the referenced catalogue. Never prorated; settled once by the run that captures it.',
		recordLabel: ['event_date', 'amount'],
		icon: 'lucide:hand-coins',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['catalogue_id'] },
			{ columns: ['employment_id', 'event_date'] },
			{ columns: ['payslip_id'] }
		]
	}
);
