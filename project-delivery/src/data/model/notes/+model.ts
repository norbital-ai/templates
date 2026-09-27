import { model } from '@norbital-ai/bolt';

/** The blank starter's note, kept read-only with its seeded row (L-TPL-project-delivery-007). */
export default model({
	description: 'A free-form note written in this workspace.',
	icon: 'lucide:sticky-note',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		body: { kind: 'text', optional: true }
	}
});
