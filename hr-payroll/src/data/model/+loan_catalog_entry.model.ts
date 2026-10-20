import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One principal loan and its agreed repayment terms for one employment.',
	icon: 'lucide:landmark',
	label: 'principal_amount',
	fields: {
		principal_amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'The principal actually lent. Leave unknown legacy principal amounts blank.'
		},
		repayment_period: {
			kind: 'period',
			of: 'date',
			optional: true,
			help: 'The first and last permitted repayment dates. Both are required for a configured loan.'
		},
		repayment_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY'],
			default: 'MONTHLY',
			help: 'The cadence used when recalculating the editable repayment schedule.'
		},
		advance_purpose: {
			kind: 'enum',
			values: [
				'HOUSE',
				'LAND',
				'VEHICLE',
				'EMPLOYER_SHARES',
				'COMPUTER',
				'MEDICAL_TREATMENT',
				'SOCSO_DISABLEMENT',
				'EDUCATION',
				'DG_APPROVED'
			],
			optional: true,
			help: 'For a Malaysian advance above one month’s wages, the permitted purpose.'
		},
		written_agreement_reference: {
			kind: 'text',
			optional: true,
			help: 'The written loan agreement required for an Indonesian payroll deduction.'
		},
		advance_made_on: {
			kind: 'date',
			optional: true,
			help: 'The actual advance date, where the jurisdiction uses it for repayment timing or an emergency-payment deadline.'
		}
	}
});
