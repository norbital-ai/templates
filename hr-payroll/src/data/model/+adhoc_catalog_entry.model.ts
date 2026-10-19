import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One ad hoc pay or recovery for one employment: a bonus, back pay or deduction priced by its ad hoc class.',
	icon: 'lucide:hand-coins',
	label: 'occurred_on',
	fields: {
		reference: {
			kind: 'text',
			optional: true
		},
		occurred_on: {
			kind: 'date'
		},
		activity: {
			kind: 'enum',
			values: ['AWARD', 'REVERSAL'],
			default: 'AWARD'
		},
		amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: "The class's bands price this amount; a REVERSAL takes back an earlier award."
		},
		quantity: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Units awarded, for a class priced per unit rather than in full.'
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			optional: true,
			help: 'Anything this award carries that the fields above do not name.'
		}
	}
});
