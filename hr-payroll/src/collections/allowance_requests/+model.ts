import { boolean, custom, defineModel, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A standing allowance a person is paid: Bob's $100 transport allowance, monthly.
 *
 * The only one of the five request families that is not a single moment in time, and the whole
 * reason it needs a family of its own. `recurrence` states either the one period it is paid in or
 * the window it is live across, and it is `notNull` — as a nullable column beside a five-armed
 * union it made two illegal states representable and cost a refusal each to forbid: a range on a
 * payment, and an allowance with no range. Both are now unsayable rather than refused.
 *
 * It is also the only family with no date column. A one-off's day is the first of the period it
 * names and a recurring allowance's is the day its window opens, so a stored date would be a second
 * statement of the same fact, free to disagree with the first.
 *
 * This is the family that prorates — a month half worked pays half an allowance — and the only one
 * whose recurring arm is captured by more than one payslip, which is why
 * `payslip_allowance_request_inputs` is the one capture junction without a unique on its source.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The pay component this is paid under; its policy decides direction and treatment. */
		allowance_catalogue_id: uuid().notNull(),
		/** A positive magnitude, paid whole in every period the recurrence covers. */
		amount: numeric().notNull(),
		/** Paid once in one stated period, or across a window. */
		recurrence: custom('allowance_recurrence').notNull(),
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
		 * The period a one-off settles in, overriding the cutoff's answer. A recurring allowance
		 * ignores it: its window already names every period it is paid in.
		 */
		pay_period: text()
	},
	{
		description:
			'A standing allowance a person is paid, either once in one stated period or whole in every period its window covers. The only request family that prorates against the days actually employed.',
		recordLabel: ['amount'],
		icon: 'lucide:calendar-clock',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['allowance_catalogue_id'] },
			{ columns: ['employment_id'] }
		]
	}
);
