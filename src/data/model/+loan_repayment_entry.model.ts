import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One generated repayment of a principal loan, consumed and locked by one payslip.',
	icon: 'lucide:landmark',
	label: 'occurred_on',
	fields: {
		occurred_on: { kind: 'date' },
		amount: { kind: 'decimal', scale: 2 },
		activity: { kind: 'enum', values: ['AWARD', 'REVERSAL'], default: 'AWARD' },
		sequence: { kind: 'int', min: 1, optional: true }
	},
	check: { positive_repayment: { amount: { gt: 0 } } }
});
