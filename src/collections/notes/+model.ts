import { defineModel, text } from '@norbital-ai/bolt/authoring';

/**
 * The one collection the blank workspace ships.
 *
 * `bolt sync` refuses a workspace with no model, so the starter carries the smallest one that means
 * something on its own: a note with a title and a body. Replace it — or delete it once you have
 * authored the first real collection — and update `counts.collections` in `norbital.template.json`.
 */
export default defineModel(
	{
		title: text().notNull(),
		body: text()
	},
	{
		description: 'A free-form note written in this workspace.',
		recordLabel: 'title',
		icon: 'lucide:sticky-note'
	}
);
