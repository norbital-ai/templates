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
		/** The pay component this claims against; its policy decides direction, caps and treatment. */
		claim_catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced component's policy. */
		amount: numeric().notNull(),
		/** The day the expense was incurred, which is not the day it was entered. */
		incurred_on: instant({ precision: 'day' }).notNull(),
		description: text(),
		/** The receipt. Required when the component's definition demands evidence. */
		evidence_file: file(),
		/**
		 * Settle this one against the direction its component declares, rather than with it.
		 *
		 * A correction is not a different kind of thing; it is a direction. `TRANSPORT_CLAIM`
		 * declares whether it adds to pay or reduces it, and an event that ticks this settles the
		 * opposite way — so clawing back a transport claim is a transport claim entry with this
		 * set, under the same component, on the same payslip line.
		 *
		 * The correction retains the original family's catalogue definition, so its source and
		 * treatment remain identifiable on the resulting payslip line.
		 */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * The settled payslip line this entry corrects, when it corrects one.
		 *
		 * Optional, and provenance only: the direction comes from `as_adjustment_entry` above, never
		 * from walking a chain. Outputs are immutable, so a correction names one and there is
		 * nothing to walk — the removed `obligations` model carried a `reverses` walk whose single
		 * flip silently doubled a negative on a reversal of a reversal.
		 */
		corrects_adjustment_id: uuid(),
		/**
		 * The period this settles in, overriding the cutoff's answer. Null is normal: the cutoff
		 * supplies the period from `incurred_on`.
		 */
		pay_period: text()
	},
	{
		description:
			'An expense a person paid for and is claiming back, dated by the day it was incurred and evidenced by its receipt. The amount is a positive magnitude; direction comes from the referenced component policy.',
		recordLabel: ['incurred_on', 'amount'],
		icon: 'lucide:receipt-text',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['claim_catalogue_id'] },
			{ columns: ['employment_id', 'incurred_on'] }
		]
	}
);
