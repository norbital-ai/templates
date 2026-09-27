import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'On-site variation order: a request to change the approved scope. A contractor raises it through an approval that Field Operations Controllers decide.',
	icon: 'lucide:git-pull-request-arrow',
	label: 'title',
	fields: {
		requested_at: { kind: 'instant' },
		title: { kind: 'text' },
		description: { kind: 'text' },
		amount: { kind: 'money', optional: true },
		source_message_id: { kind: 'text', optional: true, unique: true }
	},
	search: { text: ['title'] }
});
