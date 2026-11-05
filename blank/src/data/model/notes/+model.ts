import { model } from '@norbital-ai/bolt';
/**
 * The one starter model: a note with a title and a body, read-only (no write contract). Replace it, or delete its folder
 * once the first real model exists, and update `counts.models` in `norbital.template.json`.
 */
export default model('notes', {
	description: 'A free-form note written in this workspace.',
	icon: 'lucide:sticky-note',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		body: { kind: 'text', optional: true }
	},
	read: 'all'
});
