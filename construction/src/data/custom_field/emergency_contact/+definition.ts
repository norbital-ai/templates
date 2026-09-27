import { customField } from '@norbital-ai/bolt';

export default customField({
	description:
		'A next-of-kin name and phone number with their relationship to the worker, held so site supervision can reach someone after an incident.',
	shape: {
		kind: 'object',
		fields: {
			name: { kind: 'text' },
			phone: { kind: 'text' },
			relationship: { kind: 'text', optional: true }
		}
	}
});
