import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The calendar month the roster covers, as YYYY-MM. */
		period: text().notNull()
	},
	{
		description:
			'The roster of record for one employment over one calendar month. While it exists, the work days of that month are the schedule and outrank the shift pattern, and a payroll run refuses a cycle until every employed day inside it names a shift. Without one, the pattern projects every day.',
		recordLabel: ['period'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['employment_id', 'period'], unique: true }]
	}
);
