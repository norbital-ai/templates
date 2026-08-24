import { custom, defineModel, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		pay_component_id: uuid().notNull(),
		reference: text({ search: true }).notNull(),
		principal: numeric().notNull(),
		schedule: custom('repayment_schedule').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A staff loan, salary advance or overpayment recovery. Payroll measures the schedule directly; effective_range is the agreement period.',
		recordLabel: 'reference',
		icon: 'lucide:handshake'
	}
);
