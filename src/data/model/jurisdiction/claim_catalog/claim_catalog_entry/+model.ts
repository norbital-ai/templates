import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One expense or benefit claim for one employment, reimbursed through payroll under its claim class.',
	icon: 'lucide:receipt',
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
			help: 'What was incurred.'
		},
		quantity: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Units claimed, for a class priced per unit rather than in full.'
		},
		incurred_on: {
			kind: 'date',
			optional: true,
			help: 'When the cost was incurred. The entry day is used when unset.'
		},
		due_on: {
			kind: 'date',
			optional: true
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			optional: true,
			help: 'Anything this claim carries that the fields above do not name.'
		}
	}
});
