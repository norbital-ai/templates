import { customField } from '@norbital-ai/bolt';

export default customField({
	description:
		'A postal address for a project, broken into street lines, city, state, postal code, and country so it can be sorted and posted to rather than parsed out of one free-text line.',
	shape: {
		kind: 'object',
		fields: {
			line_1: { kind: 'text' },
			line_2: { kind: 'text', optional: true },
			city: { kind: 'text' },
			state: { kind: 'text', optional: true },
			postal_code: { kind: 'text' },
			country: { kind: 'text' }
		}
	}
});
