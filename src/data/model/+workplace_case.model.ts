import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One workplace case of an entity that a jurisdiction duty answers: a request (flexible work, access to or correction of personal data), an incident (a data breach, a work accident) or a change (a dependant). Its kind is a code the governing version lists; its subject employment is optional. Regulatory tasks rise on it being opened, changed or still open.',
	icon: 'lucide:folder-open',
	label: 'kind',
	fields: {
		kind: {
			kind: 'text',
			help: 'A code of the governing version’s case_kinds rule.'
		},
		opened_on: {
			kind: 'date'
		},
		closed_on: {
			kind: 'date',
			optional: true
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		}
	}
});
