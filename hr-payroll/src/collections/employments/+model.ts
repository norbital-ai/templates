import { custom, defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		company_id: uuid().notNull(),
		employee_number: text({ search: true }).notNull(),
		hire_date: instant({ precision: 'day' }).notNull(),
		exit_date: instant({ precision: 'day' }),
		/** Why the employment ended; MISCONDUCT is what a statutory payout exception reads. */
		exit_reason: enums([
			'RESIGNATION',
			'END_OF_CONTRACT',
			'TERMINATION',
			'RETRENCHMENT',
			'MISCONDUCT',
			'RETIREMENT',
			'DEATH',
			'OTHER'
		]),
		bank: custom('bank_account'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'One person working for one company. hire_date drives service months and every leave accrual; the pay destination lives here because one person may be paid differently by two companies.',
		recordLabel: 'employee_number',
		icon: 'lucide:briefcase',
		indexes: [{ columns: ['company_id', 'employee_number'], unique: true }]
	}
);
