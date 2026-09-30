import { model } from '@norbital-ai/bolt';

export default model({
	description: 'People at accounts. Decision-makers, buyers, and day-to-day contacts.',
	icon: 'lucide:contact-round',
	// a person's name reads "Rachel Goh", not the label separator's "Rachel · Goh"
	label: 'name',
	fields: {
		first_name: { kind: 'text' },
		last_name: { kind: 'text' },
		email: { kind: 'text', optional: true },
		title: { kind: 'text', optional: true },
		department: { kind: 'text', optional: true },
		active: { kind: 'bool', default: true }
	},
	computed: {
		name: { kind: 'text', expr: { concat: [{ field: 'first_name' }, ' ', { field: 'last_name' }] } }
	},
	search: { text: ['first_name', 'last_name'] }
});
