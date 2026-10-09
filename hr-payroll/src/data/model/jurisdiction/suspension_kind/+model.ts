import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The work-suspension catalogue of one jurisdiction settings version: the causes a suspension may name (an employer-caused shutdown, a natural disaster, a strike) and, as CEL, what a suspended day does — whether it counts as attended, whether it stays a scheduled day, and what it pays. Sealed with its version.',
	icon: 'lucide:calendar-off',
	label: 'name',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		counts_as_attended: {
			kind: 'text',
			optional: true,
			help: 'CEL: whether a suspended scheduled day counts as attended (blank = no).'
		},
		scheduled: {
			kind: 'text',
			optional: true,
			help: 'CEL: whether a suspended day stays a scheduled day (blank = yes).'
		},
		pay: {
			kind: 'text',
			optional: true,
			help: 'CEL on the payslip context with `day` and `suspension`: what a suspended day pays (blank = 0).'
		}
	}
});
