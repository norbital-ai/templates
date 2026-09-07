import { custom, defineModel, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A standing allowance a person is paid: Bob's $100 transport allowance, monthly.
 *
 * The only one of the five request families that is not a single moment in time, and the whole
 * reason it needs a family of its own. `recurrence` states either the one period it is paid in or
 * the window it is live across, and it is `notNull` — as a nullable column beside a five-armed
 * union it made two illegal states representable and cost a refusal each to forbid: a range on a
 * bonus, and an allowance with no range. Both are now unsayable rather than refused.
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
		component_catalogue_id: uuid().notNull(),
		/** A positive magnitude, paid whole in every period the recurrence covers. */
		amount: numeric().notNull(),
		/** Paid once in one stated period, or across a window. */
		recurrence: custom('allowance_recurrence').notNull(),
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
			{ columns: ['component_catalogue_id'] },
			{ columns: ['employment_id'] }
		]
	}
);
