import { boolean, custom, defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version whose calendar this day is on, sealed with it. */
		settings_id: uuid().notNull(),
		date: instant({ precision: 'day' }).notNull(),
		/** Original holiday date when this row is an explicitly scheduled substitute holiday. */
		substitutes_date: instant({ precision: 'day' }),
		name: text({ search: true }).notNull(),
		scope: custom('holiday_scope').notNull(),
		/** A gazetted public holiday; a company-rule day is the entity's own closure. */
		is_statutory: boolean().notNull().default(false)
	},
	{
		description:
			'A holiday observed under one jurisdiction settings version, including an explicit substitute date where one is declared. Drives the PUBLIC_HOLIDAY day type used by the overtime rules. Sealed with its version.',
		recordLabel: ['date', 'name'],
		icon: 'lucide:calendar-x',
		indexes: [{ columns: ['settings_id', 'date'] }]
	}
);
