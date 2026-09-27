import { model } from '@norbital-ai/bolt';

/**
 * The one starter model: a note with a title and a body. Replace it, or delete it (and its collection) once the first
 * real model exists, and update `counts.collections` in `norbital.template.json`.
 */
export default model({
	description: 'A free-form note written in this workspace.',
	icon: 'lucide:sticky-note',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		body: { kind: 'text', optional: true }
	}
});
