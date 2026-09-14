import {
	boolean,
	defineModel,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The claim type, from the catalogue; its destination, bands and opt-ins price the line. */
		catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced catalogue's destination/direction. */
		amount: numeric().notNull(),
		/** The day the expense was incurred, which is not the day it was entered. */
		incurred_on: instant({ precision: 'day' }).notNull(),
		description: text(),
		/** The receipt. Required when the catalogue row's `evidence` says so. */
		evidence_file: file(),
		/**
		 * Settle this one against the direction its catalogue declares, rather than with it.
		 *
		 * A correction is not a different kind of thing; it is a direction. `TRANSPORT_CLAIM`
		 * declares whether it adds to pay or reduces it, and an event that ticks this settles the
		 * opposite way — so clawing back a transport claim is a transport claim entry with this
		 * set, under the same catalogue, on the same payslip line.
		 */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * The period this settles in, overriding the cutoff's answer. Null is normal: the cutoff
		 * supplies the period from `incurred_on`.
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
			'An expense a person paid for and is claiming back, dated by the day it was incurred and evidenced by its receipt. The amount is a positive magnitude; direction comes from the referenced catalogue.',
		recordLabel: ['incurred_on', 'amount'],
		icon: 'lucide:receipt-text',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['catalogue_id'] },
			{ columns: ['employment_id', 'incurred_on'] },
			{ columns: ['payslip_id'] }
		]
	}
);
