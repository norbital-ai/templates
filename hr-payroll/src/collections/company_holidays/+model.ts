import { custom, defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		date: instant({ precision: 'day' }).notNull(),
		/** Original holiday date when this row is an explicitly scheduled substitute holiday. */
		substitutes_date: instant({ precision: 'day' }),
		name: text({ search: true }).notNull(),
		scope: custom('holiday_scope').notNull()
	},
	{
		description:
			'A public holiday observed by a company, including an explicit substitute date where one is declared. Drives the PUBLIC_HOLIDAY day type used by the overtime rules.',
		recordLabel: ['date', 'name'],
		icon: 'lucide:calendar-x'
	}
);
