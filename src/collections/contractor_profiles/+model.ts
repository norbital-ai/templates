import { defineModel, text, uuid } from '@norbital-ai/pod/authoring';

export default defineModel(
	{
		user_id: uuid().notNull(),
		company_name: text({ search: true }).notNull()
	},

	{
		description: 'Contractor organisation linked to the user who opens its field workspace.',
		recordLabel: 'company_name',
		icon: 'lucide:hard-hat',
		indexes: [{ columns: ['user_id'], unique: true }]
	}
);
