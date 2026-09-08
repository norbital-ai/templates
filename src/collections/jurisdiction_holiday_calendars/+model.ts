import { custom, defineModel, instant, integer, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_code: text().notNull(),
		year: integer().notNull(),
		revision: integer().notNull(),
		observations: custom('holiday_observations').notNull(),
		import_review: custom('holiday_import_review'),
		/** Publication freezes the entire annual calendar, including an explicitly empty list. */
		published_at: instant()
	},
	{
		description:
			'An independently published annual jurisdiction holiday calendar. Payroll, leave and roster views use the same published revision. Amendments require a successor revision.',
		recordLabel: ['jurisdiction_code', 'year', 'revision'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['jurisdiction_code', 'year', 'revision'], unique: true }]
	}
);
