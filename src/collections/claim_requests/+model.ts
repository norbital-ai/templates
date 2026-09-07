import { defineModel, file, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * An expense a person paid for and is claiming back: Alice's $48 taxi fare.
 *
 * One of five request families that used to be one table with a five-armed union. The evidence for
 * splitting them was that the union's discriminator became a null value — of 726 seeded entries,
 * 623 declared `BONUS`, the only arm that required no payload, and among them were 150 transport
 * allowances and 84 rows of Indonesian income tax. A shape that asks for nothing is the shape
 * everything defaults to.
 *
 * What that split buys here is visible in two columns. `incurred_on` is `notNull`, because the day
 * an expense happened is not the day it was entered and a claim without one cannot be dated into a
 * run; it was a hook refusal ("A claim must say the day it was incurred") and is now a constraint
 * the database keeps on every path, including the seed, which does not cross the authorization
 * boundary. `evidence_file` exists only here, which retires the refusal that said only a claim may
 * carry one — a bonus can no longer name a receipt, because there is nowhere to put it.
 *
 * `amount` is a positive magnitude. Direction comes from the referenced component's policy, never
 * from the request.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The pay component this claims against; its policy decides direction, caps and treatment. */
		component_catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced component's policy. */
		amount: numeric().notNull(),
		/** The day the expense was incurred, which is not the day it was entered. */
		incurred_on: instant({ precision: 'day' }).notNull(),
		description: text(),
		/** The receipt. Required when the component's definition demands evidence. */
		evidence_file: file(),
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
			{ columns: ['component_catalogue_id'] },
			{ columns: ['employment_id', 'incurred_on'] }
		]
	}
);
