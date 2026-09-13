import { defineModel, enums, instant, text, uuid, file } from '@norbital-ai/bolt/authoring';

/**
 * Documents attached to projects: brief, sow, signed_sow, supporting docs.
 */
export default defineModel(
	{
		title: text().notNull(),
		kind: enums(['brief', 'sow', 'signed_sow', 'supporting']),
		status: enums(['draft', 'review', 'signed', 'submitted']),
		markdown_body: text(),
		attachment: file(),
		project_id: uuid(),
		signed_by: text(),
		signed_on: instant(),
		submitted_on: instant()
	},
	{
		description: 'Documents linked to a project, including signed SOWs',
		recordLabel: 'title',
		icon: 'lucide:file-text'
	}
);
