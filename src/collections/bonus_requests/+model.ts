import { defineModel, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A one-off payment awarded to a person: Carol's $2,000 performance bonus.
 *
 * This is the family that used to swallow the others. As the single arm of `component_entry_event`
 * that required no payload, `BONUS` was what 623 of 726 seeded entries declared, including 150
 * transport allowances, 150 meal allowances and 84 rows of Indonesian income tax — a deduction
 * recorded as a bonus because bonus was the shape that asked for nothing.
 *
 * It still asks for almost nothing, and that is now safe: a row here cannot be an allowance,
 * because it has no recurrence to state, and it cannot be a tax deduction, because it can only name
 * a component whose `entry_kind` is BONUS.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The pay component this is awarded under; its policy decides direction and treatment. */
		component_catalogue_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced component's policy. */
		amount: numeric().notNull(),
		/** The day the award is dated to, which is what the cutoff settles it by. */
		awarded_on: instant({ precision: 'day' }).notNull(),
		note: text(),
		/** The period this settles in, overriding the cutoff's answer from `awarded_on`. */
		pay_period: text()
	},
	{
		description:
			'A one-off payment awarded to a person, dated by the day it was awarded. The amount is a positive magnitude; direction comes from the referenced component policy.',
		recordLabel: ['awarded_on', 'amount'],
		icon: 'lucide:gift',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['component_catalogue_id'] },
			{ columns: ['employment_id', 'awarded_on'] }
		]
	}
);
