import { boolean, defineModel, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_code: text().notNull(),
		calendar_id: text().notNull(),
		time_zone: text().notNull(),
		enabled: boolean().notNull().default(true)
	},
	{
		description:
			'The Google Calendar source and IANA time zone used to prepare annual holiday drafts for one payroll jurisdiction. Credentials belong to the managed connection.',
		recordLabel: 'jurisdiction_code',
		icon: 'lucide:calendar-sync',
		indexes: [{ columns: ['jurisdiction_code'], unique: true }]
	}
);
