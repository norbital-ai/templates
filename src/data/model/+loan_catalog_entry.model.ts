import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One loan instalment for one employment: the amount recovered from net pay in the month it falls due.',
	icon: 'lucide:landmark',
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
			help: 'This instalment. One instalment settles on one payslip.'
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			optional: true,
			help: 'Anything this instalment carries that the fields above do not name.'
		}
	}
});
