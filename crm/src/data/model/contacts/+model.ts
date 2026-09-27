import { model } from '@norbital-ai/bolt';

export default model({
	description: 'People at accounts. Decision-makers, buyers, and day-to-day contacts.',
	icon: 'lucide:contact-round',
	label: ['first_name', 'last_name'],
	fields: {
		first_name: { kind: 'text' },
		last_name: { kind: 'text' },
		email: { kind: 'text', optional: true },
		title: { kind: 'text', optional: true },
		department: { kind: 'text', optional: true },
		active: { kind: 'bool' }
	},
	search: { text: ['first_name', 'last_name'] }
});
