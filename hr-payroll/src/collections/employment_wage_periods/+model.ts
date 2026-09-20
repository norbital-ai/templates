import { custom, defineModel, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The inclusive dates the recorded wages belong to. */
		period: custom('instant_range', { precision: 'day' }).notNull(),
		/** Normal-hours wages due for the complete period, before sickness or unpaid-leave reductions. */
		normal_wages: custom('money'),
		/** Statutory ordinary earnings for actual qualifying work in the period. */
		ordinary_wages: custom('money'),
		/** Actual qualifying days worked; supplied with ordinary_wages, never inferred from a roster. */
		ordinary_days: numeric(),
		/** The contractual date on which the period's wages mature. */
		due_on: instant({ precision: 'day' }).notNull(),
		/** The date wages were actually received, including an advance. */
		paid_on: instant({ precision: 'day' }),
		/** Payroll, contract or opening-history evidence for the recorded figures. */
		reference: text({ search: true }).notNull()
	},
	{
		description:
			'Approved dated wage history used where statutory ordinary or normal-wage rates cannot be reconstructed from the current contract.',
		recordLabel: 'reference',
		icon: 'lucide:calendar-range',
		indexes: [{ columns: ['employment_id', 'due_on'] }],
		exclusions: [
			{
				name: 'employment_wage_periods_no_overlap',
				elements: [
					{ expr: 'employment_id', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(period - 'end')), upper(bolt_daterange(period - 'start')), '[]')",
						with: '&&'
					}
				]
			}
		]
	}
);
