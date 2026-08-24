import { custom, defineModel, enums, instant, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		worker_name: text({ search: true }).notNull(),
		worker_number: text(),
		trade: text(),
		status: enums(['active', 'inactive', 'suspended']),
		phone: text(),
		email: text(),
		emergency_contact: custom('emergency_contact'),
		date_of_birth: instant({ precision: 'day' }),
		nationality: text(),
		work_permit_expiry: instant({ precision: 'day' }),
		medical_check_date: instant({ precision: 'day' }),
		safety_induction_date: instant({ precision: 'day' })
	},
	{
		description: 'Worker roster used for job assignment and compliance checks.',
		recordLabel: 'worker_name',
		icon: 'lucide:users',
		indexes: [{ columns: ['worker_number'], unique: true }]
	}
);
