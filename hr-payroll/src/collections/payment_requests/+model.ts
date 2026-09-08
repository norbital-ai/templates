import {
	boolean,
	custom,
	defineModel,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		payment_catalogue_id: uuid().notNull(),
		amount: numeric().notNull(),
		effective_on: instant({ precision: 'day' }).notNull(),
		covers_periods: custom('covered_periods'),
		reason: text().notNull(),
		as_adjustment_entry: boolean().notNull().default(false),
		corrects_adjustment_id: uuid(),
		pay_period: text()
	},
	{
		description:
			'An approved one-off earning or deduction against an employment contract, including bonuses, departure payments and historical corrections. The catalogue defines direction and contribution treatments.',
		recordLabel: ['reason'],
		icon: 'lucide:wallet',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['payment_catalogue_id'] },
			{ columns: ['employment_id', 'effective_on'] }
		]
	}
);
