import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One holiday record.',
	icon: 'lucide:file-text',
	label: 'date',
	fields: {
		date: { kind: 'date', optional: true },
		name: { kind: 'text', optional: true },
		kind: { kind: 'text', optional: true },
		published_at: { kind: 'instant', optional: true },
		replaces: { kind: 'text', optional: true },
		given_to: { kind: 'text', optional: true }
	}
});
