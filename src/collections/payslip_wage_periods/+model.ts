import { defineModel, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		payslip_id: uuid().notNull(),
		wage_period_id: uuid().notNull()
	},
	{
		description: 'The immutable wage-history records a payslip used to price statutory rates.',
		icon: 'lucide:link',
		indexes: [{ columns: ['payslip_id', 'wage_period_id'], unique: true }]
	}
);
