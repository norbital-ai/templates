import { defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		regarding_type: enums(['accounts', 'quotes']).notNull(),
		regarding_id: uuid().notNull(),
		type: enums(['call', 'meeting', 'email', 'task', 'note']),
		subject: text({ search: true }).notNull(),
		description: text(),
		due_date: instant({ precision: 'day' }),
		completed_at: instant(),
		owner_id: uuid().notNull()
	},
	{
		description:
			'Sales activities — calls, meetings, emails, tasks, and notes — linked to an account or deal.',
		recordLabel: 'subject',
		icon: 'lucide:calendar-check',
		indexes: [
			{ columns: ['regarding_type', 'regarding_id'] },
			{ columns: ['owner_id'] },
			{ columns: ['due_date'] }
		]
	}
);
