import { boolean, defineModel, enums, file, instant, text } from '@norbital-ai/bolt/authoring';

/**
 * A client organisation Norbital delivers projects for.
 */
export default defineModel(
	{
		name: text().notNull(),
		status: enums(['prospect', 'active', 'dormant', 'archived']),
		industry: text(),
		region: text(),
		website: text(),
		nda_required: boolean(),
		nda_signed_on: instant(),
		nda_document: file(),
		notes: text()
	},
	{
		description: 'A client organisation engaged for project delivery.',
		recordLabel: 'name',
		icon: 'lucide:building-2'
	}
);
