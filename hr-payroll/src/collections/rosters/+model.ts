import { custom, defineModel, enums, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		company_id: uuid().notNull(),
		/** The payroll cycle this roster covers, in the entity's grammar: `YYYY-MM`, or `YYYY-MM-1` / `-2`. */
		period: text().notNull(),
		/** The cycle's days, resolved from the period and the entity's cutoff when the roster is written. */
		range: custom('instant_range', { precision: 'day' }).notNull(),
		origin: enums(['IMPORT', 'MANUAL']).notNull()
	},
	{
		description:
			'The roster of record for one employment over one payroll cycle. While it exists, the work days inside its cycle are the schedule and outrank the shift pattern, and a run refuses the cycle until every day of it names a shift. Without one, the pattern projects every day.',
		recordLabel: ['period'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['employment_id', 'period'], unique: true }, { columns: ['company_id'] }]
	}
);
