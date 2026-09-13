import { defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A raised issue on a submitted or in-flight project.
 */
export default defineModel(
	{
		title: text().notNull(),
		status: enums(['open', 'in_progress', 'blocked', 'resolved', 'closed']),
		severity: enums(['low', 'medium', 'high', 'critical']),
		raised_on: instant(),
		resolved_on: instant(),
		project_id: uuid(),
		owner_id: uuid(),
		description: text()
	},
	{
		description: 'An issue raised against a project.',
		recordLabel: 'title',
		icon: 'lucide:circle-alert'
	}
);
