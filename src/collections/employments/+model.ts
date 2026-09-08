import { custom, defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		company_id: uuid().notNull(),
		employee_number: text({ search: true }).notNull(),
		hire_date: instant({ precision: 'day' }).notNull(),
		bank: custom('bank_account'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it. Rehires create new contracts.',
		recordLabel: 'employee_number',
		icon: 'lucide:briefcase',
		indexes: [{ columns: ['company_id', 'employee_number', 'hire_date'], unique: true }]
	}
);
