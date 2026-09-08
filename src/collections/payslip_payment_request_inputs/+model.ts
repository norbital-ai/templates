import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		payslip_id: uuid().notNull(),
		payment_request_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one payment a payslip consumed. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the request.',
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id', 'payment_request_id'], unique: true },
			{ columns: ['payment_request_id'], unique: true }
		]
	}
);
