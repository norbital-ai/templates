import { model } from '@norbital-ai/bolt';

/** A free-form note (seeded, read-only; the crm-acceptance skill names it). Read-only: seeded notes stay visible. */
export default model('notes', {
	description: 'A free-form note written in this workspace.',
	icon: 'lucide:sticky-note',
	record_label: 'record.title',
	fields: {
		title: { kind: 'text' },
		body: { kind: 'text', optional: true }
	},
	outputs: { default: { fields: 'all' } }
});
