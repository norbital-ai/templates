import {
	custom,
	dateRange,
	defineModel,
	enums,
	integer,
	numeric,
	text
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		code: text().notNull(),
		name: text({ search: true }).notNull(),
		currency: text().notNull(),
		tax_year_start_month: integer().notNull(),
		proration: custom('proration_basis').notNull(),
		ordinary_rate_basis: enums(['DAYS_PER_MONTH', 'HOURS_PER_MONTH']).notNull(),
		ordinary_rate_divisor: numeric().notNull(),
		regime: custom('statutory_regime').notNull(),
		effective_range: dateRange().notNull()
	},
	{
		description:
			'One effective-dated statutory snapshot: currency, year boundaries, proration, ordinary-rate basis, and the atomic overtime regime used by payroll.',
		recordLabel: 'name',
		icon: 'lucide:globe',
		exclusions: [
			{
				name: 'jurisdictions_code_effective_range_no_overlap',
				elements: [
					{ expr: 'code', with: '=' },
					{ expr: 'bolt_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
