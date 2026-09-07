import { custom, defineModel, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * Money owed for periods already run and settled: three months of a raise backdated to April.
 *
 * `covers_periods` is `notNull` here, and it is the point of the family. It was an array inside a
 * jsonb union whose emptiness a hook refused by hand, and in 726 seeded entries the arm was used
 * **zero** times — everything that should have been arrears was recorded as a bonus, because a
 * bonus did not have to say what it was settling. A column the database requires cannot be avoided
 * by picking a different arm, because there is no other arm to pick.
 *
 * The periods it names may have no run, no payslip and no row anywhere: arrears for a month the
 * company had not yet onboarded is the ordinary case, which is why they are a list of values rather
 * than a relation.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The pay component this settles under; its policy decides direction and treatment. */
		component_catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced component's policy. */
		amount: numeric().notNull(),
		/** The day the settlement is dated to, which is what the cutoff settles it by. */
		settled_on: instant({ precision: 'day' }).notNull(),
		/** The past pay periods this makes good, each `YYYY-MM`. At least one. */
		covers_periods: custom('covered_periods').notNull(),
		/** Why the money was owed. Stated, not optional: arrears without a reason cannot be audited. */
		reason: text().notNull(),
		/** The period this settles in, overriding the cutoff's answer from `settled_on`. */
		pay_period: text()
	},
	{
		description:
			'Money owed for pay periods already run, naming the periods it makes good and why. The amount is a positive magnitude; direction comes from the referenced component policy.',
		recordLabel: ['settled_on', 'amount'],
		icon: 'lucide:history',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['component_catalogue_id'] },
			{ columns: ['employment_id', 'settled_on'] }
		]
	}
);
