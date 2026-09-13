import { boolean, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A person at a client company.
 */
export default defineModel(
	{
		full_name: text().notNull(),
		job_title: text(),
		email: text(),
		phone: text(),
		company_id: uuid(),
		is_primary: boolean(),
		notes: text()
	},
	{
		description: 'A person working at a client company.',
		recordLabel: 'full_name',
		icon: 'lucide:user-round'
	}
);
